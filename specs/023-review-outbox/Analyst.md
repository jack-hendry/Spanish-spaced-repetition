# Analyst — 023 · Never lose a review in flight

Phase 3 of `specs/011-mobile-remote-access/ROADMAP.md`.
**Size: Large** — it touches the web review loop, a new `core/` module, the
server's `/api/review` durability contract, and the on-disk revlog's
uniqueness assumption. The sizing rule also forces Large on its own:
anything touching the study queue or the persistence path is at least Large.

## 1. What problem are we solving?

`Review.rate()` (`web/src/app/features/review/review.ts`) updates local state
optimistically and then `await`s a POST. The POST is **never retried**. On a
flaky cellular link the card is gone from the queue locally while the server
never heard about it, and the review is lost on the next reload. This is the
highest-likelihood way to lose progress once the phone is in play, and it
violates the roadmap's second non-negotiable ("progress is never lost").

Three facts found while reading the code sharpen the problem beyond what the
roadmap bullet says:

1. **One rating is not one write.** `rate()` issues *up to 2 + N* independent
   server calls: `POST /api/review` (card + revlog), then
   `store.recordStudied()` → `PATCH /api/decks/:id {daily}`, then
   `store.burySiblings()` → one `PATCH /api/cards/:id {queue:'schedBuried'}`
   per sibling. A retry story that covers only the first still silently loses
   the daily tally and the bury. Anything landing partially is a half-applied
   review.
2. **The non-idempotent half is the revlog, and only the revlog.** Card and
   deck writes are absolute-value replacements (`cards[idx] = {...card}`,
   `Object.assign` on the deck), so replaying them is harmless *given FIFO
   order*. `store.appendRevlog()` (`server/src/store/file-store.ts:216`) is a
   bare `appendFile` with no uniqueness check — replay double-counts a review
   forever, and the revlog is the append-only record the repair tool in
   `specs/BACKLOG.md` would one day rebuild `cards.json` from.
3. **The idempotency key already exists.** `RevlogEntry.id` is generated
   client-side at scheduling time as `r{now}-{random}`
   (`core/scheduling/sm2.ts:37`, `fsrs.ts:52`). A retry of a queued entry
   carries the *same* id, because the id is minted once by the scheduler, not
   per HTTP attempt. Nothing needs to be invented.

## 2. What is in scope?

A durable, ordered, client-side **outbox** for the writes the study loop makes,
plus the one server change that makes replaying them safe.

**Web (`web/src/app/core/outbox/` — new)**
- A persisted FIFO queue of pending API mutations, survivng reload/tab-kill.
- A drain loop with backoff, reconnect handling, and failure classification.
- Routing of the study loop's writes through it: `POST /api/review`,
  `PATCH /decks/:id {daily}`, `PATCH /cards/:id {queue}` (bury, suspend,
  unbury) and `PATCH /collection {lastUnburyDay}`.
- `Review.rate()` no longer awaits the network before advancing.
- UI: a shell banner showing unsent count/state, a `beforeunload` guard, and a
  gate that refuses to *start* a study session while the outbox is non-empty.

**Server (`server/src/`)**
- `POST /api/review` becomes safe to replay: a revlog entry whose `id` was
  already appended is skipped, not appended twice. Response stays 200 so the
  client dequeues.

**Verification**
- Unit specs for the outbox (persistence, ordering, backoff, classification).
- A server integration test that POSTs the same review twice and asserts the
  revlog gained exactly one line.
- A real offline run: airplane mode mid-session, several cards, reconnect.

## 3. What is OUT of scope?

Named explicitly, because each is a plausible drag-in:

- **Phase 4 — staleness / cross-device conflicts.** No `modified` precondition,
  no generation token, no rejection of a stale write. Phase 3 makes a write
  *arrive*; making a *late* write lose to a newer one is Phase 4. Do not add a
  version check "while we're in there" — it would make the outbox's replays
  fail, which is the opposite of this spec.
- **Offline app shell.** No service worker, no PWA manifest, no cached media,
  no offline *reload*. A reload while offline shows the gate from §2 and stops;
  it does not let the user keep studying. Offline capability here means
  "a session already in progress survives losing the network", nothing more.
- **The `revlog.ndjson` → `cards.json` repair tool** (`specs/BACKLOG.md`,
  2026-09-17) and the **`/api/review` hard-kill divergence** (same backlog
  entry set, spec 022's O2). This spec makes the *client* durable; the
  server-side debounce window is untouched.
- **Non-study writes.** Note edits (`browse`), deck options, pause/resume, and
  import stay direct calls. They are desktop-side, synchronous, user-visible
  actions with an operator watching; queueing them adds surface for no gain.
- **Any scheduling math.** The scheduler is not touched. `SchedulingResult`,
  `RevlogEntry`'s shape, day numbers, `due` overloading — all unchanged. The
  outbox transports what the scheduler already produced.
- **Retiring the optimistic local update.** Local-first stays; the outbox is
  what makes it honest.

## 4. Design decisions

**D1 — The outbox holds *every* write a rating makes, not just the review.**
One rating enqueues 1 + 1 + N ops as a group, in the order `rate()` issues them
today. Rationale: fact (1) above. A partially-applied rating is a corrupted
schedule, and the daily tally is what makes limits survive a reload.

This makes *loading the collection* an outbox-producing operation too (C-3):
`CollectionStore.load()` ends with `await this.unburyForNewDay()`
(`collection.store.ts:146`), which issues one `PATCH /cards/:id` per buried
card plus `PATCH /collection {lastUnburyDay}`. Those go through the outbox
like everything else. It converges because the local signals are set before
the awaits and FIFO puts the unbury behind any reviews left over from the
previous session — do not "optimise" it back onto the direct path.

**D2 — `localStorage`, not IndexedDB.** Synchronous write is the whole point:
the enqueue must be *committed* before `rate()` returns, so a tab kill between
the tap and the POST cannot lose it. IndexedDB's async transaction re-opens
exactly the window this spec exists to close. Budget, **measured** (C-1), not estimated: a serialised `Card` is 304 B
(`JSON.stringify(cards[0])`) and a revlog line averages 192 B
(`wc -c / wc -l` over `revlog.ndjson`), so a review op is ≈600 B with its
envelope; a `daily` patch ≈150 B and a bury ≈120 B. A 200-card session is
therefore **≈150 KB** against a ~5 MB quota — a 30× margin. A hard op cap
with a loud UI covers the rest; a `QuotaExceededError` must surface, never be
swallowed.

**D3 — `rate()` stops awaiting the network.** Enqueue synchronously, then
advance. This is what makes an offline session possible at all and is required
by the roadmap's own acceptance test ("airplane-mode mid-session, answer
several cards"). The user's tap latency stops depending on cellular RTT — a
side benefit, not the reason.

**D4 — Replay safety is a revlog-id dedupe, and FIFO order is load-bearing.**
The case that forces this is not a buggy client: it is a POST the server
**applied successfully** whose response never arrived (C-6). The client cannot
tell that apart from a failure, so it is obliged to retry, and the server is
obliged to absorb it. Without the dedupe, the single most likely cellular
failure mode produces a *duplicated* review instead of a lost one — the same
corruption wearing different clothes.
`FileStore` holds an in-memory `Set<string>` of revlog ids, populated at
`init()` by reading `revlog.ndjson` (3,923 lines / 753 KB today — trivial) and added to
on every append. `appendRevlog` becomes a no-op for a known id. Everything else
is idempotent *only because ops apply in order*: two ratings of the same card
write absolute card states, and out-of-order delivery would resurrect the older
one. Ordering is therefore a correctness requirement, not a nicety — it must be
stated in the code, not just implied by the queue.
The set grows without bound; that is accepted (C-7). Ten years at the measured
rate is ≈85 MB and a slow boot, not a failure, and `readRevlog()` already does
a full pass for `GET /revlog`. The escape hatch — retain only the last N ids,
since a replay happens within hours, never months — is named here and
deliberately **not built**.

**D5 — Drain policy: one in-flight request, FIFO, head-of-line blocking.**
Exponential backoff **2s** → 4s → 8s … capped at 60s; immediate drain on the
`online` event and at app start, but **never** immediately after a failure
(C-5). The tier-1 rate limiter covers every route at 20 failures per 15
minutes with `skipSuccessfulRequests: true` (`app.ts:70-78`), so a fast retry
loop burns that budget alone and converts a network blip into a 15-minute
lockout of the whole app while the banner says the reviews are unsaved. A 429
with `Retry-After` honours it. Classification:
- **2xx** → dequeue. The *only* thing that removes an op.
- **Retryable** (network error / status 0, 408, 429, 5xx, 401, 403) → keep at
  the head, back off, retry forever. 401/403 are retryable on purpose: Basic
  credentials can come back, and the rate limiter (roadmap Discovered,
  2026-09-17) 429s a normal page load.
- **Poison** (400, 404, 422) → moved to a retained `failed` list, still
  persisted, surfaced in the UI, never auto-deleted, and skipped so the queue
  behind it drains. Skipping is safe under D4: a later op for the same card
  carries a later absolute state.

**D6 — Starting a study session requires: outbox drained, *then* the
collection re-loaded.** On reload the server is behind local state, so cards
fetched before the drain re-serve cards the user already answered.

"Wait for the outbox to be empty" is **not sufficient**, and this is the one
place round 1 changed the design (C-2). `App`'s constructor fires
`void this.store.load()` unconditionally at startup (`app.ts:51`), which
fetches `/api/cards` immediately — *before* any drain can finish. By the time
`Review.init()` evaluates a naive gate the ops are gone but the in-memory card
array is still the pre-drain one, so the answered card is back in the queue.

The gate is therefore **drain → re-load the collection → start**. Note
`load()` self-guards on `this.loading()` (`collection.store.ts:135`) and
returns immediately if a load is already in flight, so the post-drain reload
must be sequenced after the startup load, not fired alongside it. While
blocked the route shows "syncing N reviews…", or offline, "N reviews not yet
saved — reconnect to continue". Browsing and stats are not gated; only the
study entry point is.

**D7 — Surfaces.** (a) A shell banner in `app.html`, modelled on the existing
`pause-banner`, showing count + state (syncing / offline / needs attention);
(b) a `beforeunload` guard while the outbox is non-empty; (c) the D6 gate.
Silent loss is the failure mode that matters, so every state above has a
visible representation.

## 5. How do we know it is done?

**All eight criteria MET as of 2026-10-11.** Verdicts and evidence below;
full detail lives in `tasks.md` Steps 13, 14 and 17.

- **A1** — Killing the network mid-session, answering 5 cards, then restoring
  it results in all 5 landing: `revlog.ndjson` gains exactly 5 lines, the 5
  cards' `due`/`interval` match what the client showed, and the deck's `daily`
  tally advanced by the right amount.
  **Amended 2026-09-18 (user-approved): A1 covers TEXT cards only.** A Listening
  card's audio is served by Express from `data/spanish/media/` and there is no
  service worker (§3 puts a PWA out of scope), so an audio card is unusable
  offline however well the outbox behaves. Offline audio is a PWA feature, not
  an outbox feature — see `## Discovered`.
  A1 also depends on the note cache being warm: `loadNext()` reads each card's
  note over the network, so the session start now bulk-loads notes via
  `store.loadNotes()`. Without that, offline study stalls on the first uncached
  note regardless of the outbox.
  **MET at n=5** (Step 13 run 5, 2026-09-18, text deck only, as amended):
  `revlog.ndjson` 3933 → 3938, exactly +5, five distinct ids; card `due`/
  `interval` matched the UI; the deck `daily` tally reset and counted all 5.
- **A2** — Answering cards offline, then **killing the tab while still
  offline**, loses nothing: on the next load *after reconnecting*, the outbox
  still holds those ops and drains them.
  Note what A2 deliberately does **not** claim: the tab cannot be *reloaded*
  while offline. There is no service worker (verified — no `ngsw`, no
  `manifest.webmanifest`, `@angular/service-worker` not installed), so the app
  shell is served by Express and an offline reload is a browser error page, not
  the app. The ops survive in `localStorage` regardless; what does not survive
  is the ability to keep studying. See `## Discovered`.
  **MET** (Step 13 run 5, 2026-09-18): 5 ops survived an offline tab close and
  reopen, drained correctly on reconnect — same run as A1's evidence above.
- **A3** — `POST /api/review` with an identical body twice appends **one**
  revlog line. Pinned by a server integration test, not by inspection.
  **MET** (Steps 1–2): `file-store.revlog-dedupe.test.ts` (3 cases) and
  `review-idempotency.integration.test.ts` (3 cases) pin it at the store level
  and through the real Express route; both green in the current suite
  (server 88/14).
- **A4** — Replaying an outbox out of order is impossible by construction, and
  the FIFO/one-in-flight guarantee is pinned by a web spec.
  **MET** (Step 6): `outbox.service.spec.ts`'s FIFO-under-failure case asserts
  `api.send` was called with the head op only while an earlier op is
  retrying — verified falsifiable (fails with the single-flight guard
  deleted).
- **A5** — With pending ops, the study route refuses to start a session and
  says why; the shell shows a non-zero unsent count; `beforeunload` fires.
  **MET** (Step 17, confirmed 2026-10-11 after fixing two stacked defects —
  see `## Discovered` and `tasks.md` Step 17's Status). Manual repro at
  `localhost:3000`: offline, answered one card, re-entered the deck → "N
  reviews not yet saved — reconnect to continue" with no rating buttons,
  held there for as long as the network stayed offline; reconnecting recovered
  automatically and served a card that was not the one already answered.
- **A6** — A poison response (404) does not wedge the queue: the op lands in
  `failed`, is still visible, and the ops behind it drain.
  **MET** (Step 13 run 5, 2026-09-18): two hand-seeded `PATCH
  /cards/does-not-exist` ops were classified poison, the banner showed "2
  reviews could not be saved" with a Retry button, and two subsequently-
  answered cards drained past them (`revlog.ndjson` 3938 → 3940).
- **A7** — `npm run test` green (server + web), `npm run build` green,
  `npm run lint:ci` and `npm run format:check` green.
  **MET**, re-verified 2026-10-11 independently of any implementer's claim:
  server 88/14, web 268/23, 0 failures; `npm run build` exit 0 both
  workspaces; `lint:ci` and `format:check` clean.
- **A8** — The real run: airplane mode on the phone against
  `https://spanish-srs.fly.dev`, several cards, reconnect, and every review
  landed **exactly once** — verified against the live revlog, not the UI.
  **MET at n=5** (Step 14, 2026-09-18): live `revlog.ndjson` 3923 → 3928,
  exactly +5 with five distinct ids, no id duplicated anywhere in the 3928
  live lines, no card re-served after reconnecting.

## Discovered

- **(2026-09-18, Step 13 run 5) The shell banner calls every queued op a
  "review", so it overstates unsaved study by roughly 3x.** Observed live:
  after five offline cards the banner read **"Saving 15 reviews…"** while only
  five reviews existed — the other ten ops were one `daily-` tally and nine
  buries. This is D1's "a rating is 2 + N writes, not one" surfacing in the UI.
  The queue is correct (all 15 ops landed, revlog +5 exactly); only the wording
  is wrong. It matters because this banner is the *one* place the user is told
  how much work is unsaved, and Step 10's "stuck" screen borrows the same count
  — a user who answered 5 cards and is told 15 are unsaved cannot tell whether
  the app has lost track. The honest text is ops, not reviews ("15 unsaved
  changes" / "5 reviews + 10 related updates"), or count only ops with
  `path === '/review'`. `app.ts` is in no remaining step's `Files` list, so this
  is recorded rather than fixed inline (scope discipline).

- **(2026-09-18, Step 14) The tier-1 rate limiter counts 401 auth challenges,
  and a stuck outbox op can hold the lockout open indefinitely.** Hit live on
  the first phone load after `fly deploy`: "Too many requests, please try again
  later", with no way in — the 429 applies to the auth challenge itself.
  Two separate facts combine here.
  1. **Pre-existing, not introduced by 023.** The tier-1 limiter
     (`app.ts:70-78`, 20 non-2xx per IP per 15 min, `skipSuccessfulRequests`)
     sits **before** `basicAuth`, so every 401 challenge is counted as a
     failure. A cold SPA load behind Basic auth emits a burst of them —
     index.html, the bundles, then `/api/collection` and `/api/cards` — before
     the browser has credentials to attach. Two or three load attempts spend the
     whole budget. `trust proxy` is 1 (`app.ts:39`), so this is per-client, not
     a shared bucket — the phone burned its own 20.
  2. **The 023 interaction is the interesting half.** `classify()` maps
     **429 → `'retry'`** and `backoffMs` caps at 60 000 ms, so one op stuck
     behind a 429 retries about once a minute: **~15 failures per 15-minute
     window from a single op, 75% of the entire budget**, topping the window up
     nearly as fast as it drains. C-5 set the 2 000 ms floor to stop a *fast*
     retry loop locking the app out; it does not stop a *slow* one from holding
     the lock open. A phone on a flaky link is exactly that state.
  Cleared for this run by `fly apps restart spanish-srs` — the limiter store is
  in-memory, so a restart resets every counter. That is an operator workaround,
  not a fix. Candidate fixes, all outside this spec: skip 401s in the tier-1
  count (it exists to bound credential *guessing*, and an unauthenticated first
  load is not that), or special-case 429 in the outbox to back off far beyond
  60 s, or honour `Retry-After` as a floor rather than only when larger.
  Not fixed here — `server/src/app.ts` and the backoff policy are in no
  remaining step's `Files` list (scope discipline).

- **(2026-09-18, C-4) `PauseService.recoverOnLoad()` is a second writer to
  `cards.json` outside the outbox.** `app.ts:51-53` calls it on every start and
  `pause.service.ts:66` re-sends a saved `POST /collection/resume` payload,
  which rewrites `due` on every card. That path is out of scope (§3, non-study
  writes), so with a non-empty outbox there are two independent writers with no
  ordering between them. Not fixed here: `resume` no-ops unless `pausedAt`
  matches the exact episode it was computed against (`routes/index.ts:66`), and
  pause/resume is a desktop action. Recorded so the next person does not
  re-derive it mid-incident.
- **(2026-09-18, Step 13 manual) A hung request wedges the outbox permanently —
  no request timeout.** Live evidence from the user's `localStorage` after an
  offline session: 5 ops (3 reviews + 2 buries), **every one with
  `"attempts": 0`** and `failed: []`. `attempts` is incremented in `drain()`'s
  `catch` before backoff is scheduled, so `attempts: 0` on every op proves no
  delivery was ever attempted *or classified* — the queue was not retrying and
  failing, it was not trying at all.
  Cause: `drain()` awaits `lastValueFrom(this.api.send(...))` and Angular's
  `HttpClient` has **no default timeout**. A request that HANGS rather than
  erroring never settles, so the `catch` never runs and `drainPromise` stays
  non-null forever; every later `drain()` — from `enqueue`, from the `online`
  listener, from Step 10's gate — coalesces onto that dead promise and returns.
  **This is the spec's own failure mode: a dying mobile connection hangs, it
  does not fail fast like DevTools' offline toggle.** Every test and both
  automated verification runs used fail-fast errors, so nothing exercised it.
  Fixed with an rxjs `timeout` on the outbox request, classified as `'retry'`.
  The transferable point: **an offline test that only simulates clean failures
  does not test offline.** The interesting network state is *stalled*, not
  *refused*.
  Worth recording that the ops themselves were perfectly formed — `revlog.id`
  used as the op id, bury ops carrying the prescribed `bury-<cardId>-<ts>`
  pattern, and correct client-side scheduling (`button: 3`, `type: 'relearn'`,
  `interval: 1`) computed with no network at all. Steps 7 and 8 did their job;
  the defect was entirely in delivery.
- **(2026-09-18, Step 13 manual) The spec removed the network WRITE but never
  audited the network READ — so offline study did not actually work.** D3 made
  `rate()` non-blocking, but `loadNext()` still does
  `await this.store.getNote(card.noteId)` (`review.ts:214`), and on a cache miss
  `getNote` does `await lastValueFrom(this.api.getNote(id))`
  (`collection.store.ts:177`). Offline, the loop stalls on the first card whose
  note is not already cached. **Found by the user driving the app by hand, after
  two automated runs had missed it** — the automation's early cards were cached
  from its online warm-up, so it reported "each card advanced immediately" and
  the read path never showed. Fixed (user-approved) by warming the cache with
  the existing bulk `store.loadNotes()` at session start, the same call
  `browser.ts:89` already makes. **The transferable lesson: "make X not block on
  the network" is not done until BOTH directions are audited; a write-path fix
  reads as complete while the read path silently holds the same lock.**
- **(2026-09-18, Step 13 manual) A1 cannot hold for audio cards, at all.** Media
  is served by Express from `data/spanish/media/` (7,241 files) and there is no
  service worker (§3 puts a PWA out of scope), so a Listening card has no audio
  offline no matter what the outbox does. A1 is therefore amended to **text
  cards only**; offline audio is a PWA feature, not an outbox feature.
- **(2026-09-18, Step 12) The lint pass leaked a behaviour change into an
  out-of-scope file.** Making `CollectionStore.suspendCard`/`unsuspendCard`
  callers lint-clean turned `Browser.toggleSuspend` fully synchronous, so its
  `busy` guard stopped awaiting `unsuspendCard` — which is still async and still
  does real HTTP — and the button re-enabled mid-request, losing double-click
  protection. `browser.ts` is in no step's `Files` list; it was pulled in purely
  as a caller. Caught by reading the diff, not by any test: nothing covers the
  `busy` flag. Fixed by awaiting only the async branch. **The general point is
  that a signature change ripples to callers the spec never enumerated, and a
  "lint-only" pass is exactly where that goes unnoticed.**
- **(2026-09-18, Step 12) Two spec instructions were overruled by ESLint, with
  the user's explicit agreement.** Both surfaced at the Step 12 lint gate and
  were decided by the user, not silently by the implementer:
  1. Step 7 said "keep every method `async`", but after the enqueue rewrite
     `burySiblings`, `recordStudied`, `suspendCard` and `unburyForNewDay` await
     nothing, so `@typescript-eslint/require-await` fires. They are now sync
     `void`. No behaviour change — every caller already treated them as
     fire-and-forget after Step 8 — but the public signatures did change.
  2. Step 11 prescribed `e.returnValue = ''` in the `beforeunload` handler; the
     property is deprecated and lint flags it. The handler now calls
     `preventDefault()` only, which is the modern standard and is what Chrome
     and Safari honour. Older browsers may not prompt.
  The general lesson is the `L-NNN` candidate: a `tasks.md` step that pins an
  exact code shape can be invalidated by a lint rule the planner never ran, and
  the step's own "report, don't quietly redesign" clause is what keeps that
  visible.
- **(2026-09-18, Step 10) The C-2 gate's post-drain reload can still silently
  no-op — the race is narrowed, not closed.** `CollectionStore.load()` opens
  with `if (this.loading()) return;` (`collection.store.ts:137`), which returns
  *immediately* rather than awaiting the in-flight load. So if `App`'s startup
  `load()` is still running when `Review.init()`'s post-drain
  `await this.store.load()` fires, that reload is skipped and the pre-drain card
  array survives — exactly the C-2 bug the gate exists to prevent. In practice
  the awaited `drain()` costs at least one network round-trip, so the startup
  load has almost always settled first; the window is small but it is widest
  precisely where it matters (slow mobile link, non-empty outbox). Step 10 was
  implemented as specified and its `If blocked` clause did not trigger — the
  reload is not *unconditionally* a no-op — so this is recorded, not fixed
  inline. A real fix is for `load()` to return the in-flight promise instead of
  `void`, which is a `CollectionStore` change outside this spec's scope.
- **(2026-09-18, C-8) Client and server `card.modified` diverge permanently.**
  `POST /review` assigns `modified: Date.now()` server-side
  (`routes/index.ts:120`) and `rate()` already discards the response
  (`review.ts:284`) — which is *why* D3 is safe to do. The divergence is
  pre-existing, not introduced here, and `modified` is exactly the field
  **Phase 4** will want for its staleness precondition. Phase 4 input, not a
  bug to fix in Phase 3.
- **(2026-09-18) "Offline" here means a *running tab*, never a *cold load*.**
  D3 makes the review loop network-independent once a session is underway —
  that is the subway-tunnel case, and it is the whole point of Phase 3. It
  cannot make the page *load* network-independent: with no service worker
  (none installed, verified 2026-09-18) the shell, the collection and the media
  all come from Express. So: network drops mid-session → keep studying, drains
  on reconnect. Reload or cold-start while offline → browser error page, ops
  safe in `localStorage`, studying resumes when the network does. Anyone who
  wants the second case is asking for a PWA, which §3 puts out of scope.

- **(2026-10-11, Step 17 re-verification) A detached method call lost its
  `this` binding and crashed inside an uncaught `catch` block, silently
  rejecting the promise `Review.init()` unconditionally awaited.**
  `OutboxService.getRetryDelay()` did
  `const getMethod = headers?.['get']; getMethod?.('Retry-After')` — extracting
  Angular's `HttpHeaders.get` into a bare variable detaches it from its `this`,
  and `HttpHeaders.get()` internally calls `this.init()`, so the detached call
  throws `TypeError: Cannot read properties of undefined (reading 'init')`.
  This only reproduces against a **real** `HttpHeaders` instance — which a
  genuine `HttpErrorResponse` carries even at status 0 — so every existing
  test, which mocked `headers` as a plain object, never exercised the real
  bound method and the bug shipped invisibly through Step 6's falsifiability
  check, Step 12's full-gate checkpoint, and the first pass of this very step.
  Because the throw happens synchronously inside `_runDrain()`'s `catch`
  block (called from the handler itself, not from the `try`), nothing in the
  service catches it — `_runDrain()`'s promise **rejects**, which propagates
  straight through `Review.init()`'s unguarded `await this.outbox.drain()`.
  Execution never reaches the code that sets `syncing` to `'stuck'`, so the
  component stays wedged on "Syncing…" regardless of what the queue does in
  the background afterwards — exactly the symptom reported after Step 17's
  first fix landed (the "open question" that fix left unexplained). Found by
  temporary `[A5-DEBUG]` console instrumentation plus one more manual repro,
  not by guessing; fixed by calling `.get` directly on `headers` in one
  chained expression (`headers?.get?.('Retry-After')`) so `this` stays bound.
  Regression test added using `new HttpErrorResponse({ status: 0, headers: new
  HttpHeaders() })`, verified red against the unfixed code (same error
  signature as the browser) and green after.

## Retrospective

### What `Analyst.md` and the critic caught up front

- **C-2 was the finding that paid for the whole harden round.** "Wait for the
  outbox to be empty" would have shipped a gate that reads a pre-drain card
  array and re-serves an answered card. Catching it on paper made Step 10 a
  15-minute change instead of a silent correctness bug in production.
- **D4's choice of `RevlogEntry.id` as the op id** meant the client's queue key
  and the server's dedupe key were the same value by construction, so A3 fell
  out of the design rather than needing a reconciliation pass.
- **C-5's rate-limiter arithmetic** (20 failures / 15 min, `skipSuccessfulRequests`)
  set the 2 000 ms backoff floor. A naive retry loop would have locked the app
  out of *every* route, not just `/review`.
- **D1's "a rating is 2 + N writes, not one"** is why Step 7 exists. Queueing
  only the review would have lost the daily tally and the bury.

### What turned out wrong during coding

1. **Test-only "Done when" bullets cannot see a `tsc` error.** Step 1 passed
   every bullet it was given while `npm run build` was red — vitest does not
   type-check. The Step 5 checkpoint caught it. Every later step got an explicit
   build bullet. **This is the strongest process finding of the spec: a step's
   acceptance commands are the step's real definition, and "tests pass" is not
   the same claim as "it compiles".**
2. **A guard that early-returns makes its caller's `await` meaningless — twice.**
   `drain()`'s single-flight guard returned instead of awaiting the in-flight
   run, so Step 10's gate read a stale queue and declared a healthy session
   "stuck". The identical shape exists in `CollectionStore.load()` (still
   present, logged in `## Discovered`). One instance is a bug; two in one
   codebase is a pattern worth naming. See the `L-NNN` this spec earned.
3. **The spec audited the write path and never the read path.** D3 removed the
   network write from `rate()`, and everyone — planner, critic, three
   implementers and two automated verification runs — read that as "the review
   loop no longer needs the network". `loadNext()` was still doing a network
   *read* per card the whole time. **The user found it by hand in under a
   minute.** The automation missed it precisely because its online warm-up had
   cached the early cards, so the stall never reproduced.
4. **The plan's own file lists were not the real blast radius.** A signature
   change in `collection.store.ts` rippled into `browser.ts`, which appears in
   no step's `Files` list, and silently removed double-click protection there.
   Nothing tested it; only reading the diff caught it.
5. **Browser automation could not do the manual step, and said so late.** Two
   runs burned on `beforeunload` blocking programmatic navigation and on stale
   `localStorage` from the previous aborted run. The step should have been
   `top-level` + user from the start, like Step 14 — its `Model: haiku` was
   optimistic about what a subagent can drive.
6. **Step 17's own "Done when" gates — a green test suite, a clean build, a
   clean lint — certified a fix that did not fix the reported symptom, twice
   in a row.** The first pass fixed a real defect (the coalescing branch
   bypassing backoff) with a falsifiable test, and still explicitly flagged
   "the fix does not explain the symptom that was actually observed" rather
   than claiming done — and that caution was earned: a second, unrelated
   defect (the `getRetryDelay` `this`-binding crash, above) was the one
   actually wedging the gate the user hit. Both defects share a shape worth
   naming: **every test in this spec that exercises `_runDrain()`'s error path
   mocks the thrown error as a plain object, never a real `HttpErrorResponse`
   with a real `HttpHeaders` instance** — so a bug that only exists when a
   *real* framework object's methods are called could not have been caught by
   any test as written, and wasn't, across three separate implementation and
   checkpoint passes. Found only by adding temporary console instrumentation
   and reading a real browser's stack trace — the thing a green suite cannot
   produce. See the `L-NNN` candidate this earns, distinct from item 2's
   early-return-guard pattern.

### What the plan got right about its own limits

C-10's insistence that A2 cannot claim an offline *reload* — no service worker,
so a cold load is a browser error page — held up exactly as written, and the
same reasoning is what made the audio finding easy to classify rather than
argue about. Writing down what a criterion does **not** claim was worth as much
as writing down what it does.
