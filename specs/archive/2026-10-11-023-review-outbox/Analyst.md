# Analyst — 023 · Never lose a review in flight

*Abridged when archived: `## 5. How do we know it is done?`; `## Retrospective` removed to fit the 20 KB archive cap. Full text in git history.*

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

## Discovered

Condensed at archive time. Each item's durable half is already recorded in
`specs/STATE.md`, `specs/LESSONS.md`, `specs/BACKLOG.md` or the Phase 3 section
of `specs/011-mobile-remote-access/ROADMAP.md`; full original text is in git
history.

**Fixed inside this spec (both found by the user driving the app by hand, after
automated runs reported success):**

- **(Step 13) A hung request wedges the outbox permanently — no request
  timeout.** `HttpClient` has no default timeout, so a request that *stalls*
  rather than erroring never settles: the `catch` never runs, `drainPromise`
  stays non-null forever, and every later `drain()` coalesces onto a dead
  promise. Live proof was 5 queued ops with `"attempts": 0` on every one — not
  retrying and failing, never trying. Fixed with an rxjs `timeout`, classified
  `'retry'`. **A dying mobile connection hangs; it does not fail fast like
  DevTools' offline toggle, so an offline test built on clean failures does not
  test offline.**
- **(Step 13) The spec removed the network WRITE and never audited the network
  READ.** D3 made `rate()` non-blocking, but `loadNext()` still awaited
  `store.getNote()`, which hits the network on a cache miss — so offline study
  stalled on the first uncached note. Missed by two automated runs because
  their online warm-up had cached the early cards. Fixed by warming the cache
  with the existing bulk `store.loadNotes()` at session start. **"Make X not
  block on the network" is not done until both directions are audited.**
- **(Step 17) A detached method call lost its `this` and silently rejected the
  promise `Review.init()` awaited** — `getRetryDelay()` extracted
  `HttpHeaders.get` into a bare variable; the detached call throws, inside an
  uncaught `catch`, so the component stayed wedged on "Syncing…". Reproduces
  only against a **real** `HttpHeaders`, which every test had mocked as a plain
  object — so three implementation and checkpoint passes could not have caught
  it, and didn't. Fixed via `headers?.get?.('Retry-After')`; regression test
  uses a real `HttpErrorResponse`. See **L-029**.

**Recorded, deliberately not fixed here (scope discipline — each names files in
no remaining step's `Files` list):**

- **The shell banner calls every queued op a "review", overstating unsaved
  study ~3x** — five offline cards read "Saving 15 reviews…" (5 reviews + 1
  daily tally + 9 buries). The queue was correct; only the wording is wrong. It
  matters because this banner is the one place the user learns how much is
  unsaved. Honest text is ops, or count only `path === '/review'`.
- **The tier-1 rate limiter counts 401 auth challenges, and a stuck outbox op
  holds the lockout open.** Pre-existing: the limiter sits before `basicAuth`
  (20 non-2xx / IP / 15 min), so a cold SPA load behind Basic auth spends the
  budget on challenges. The 023 interaction is that 429 → `'retry'` with a 60 s
  backoff cap means one stuck op contributes ~15 failures per window, ~75% of
  the budget — C-5's 2 000 ms floor stops a *fast* retry loop locking the app
  out, not a *slow* one holding the lock. Cleared live with
  `fly apps restart spanish-srs` (in-memory store) — an operator workaround.
  Candidate fixes: skip 401s in the tier-1 count, back off far beyond 60 s on
  429, or treat `Retry-After` as a floor.
- **`PauseService.recoverOnLoad()` is a second writer to `cards.json` outside
  the outbox** (`app.ts:51-53` → `pause.service.ts:66` re-sends
  `POST /collection/resume`, rewriting `due` on every card). With a non-empty
  outbox there are two independent writers and no ordering between them.
  Mitigated by `resume` no-opping unless `pausedAt` matches its exact episode.
- **The C-2 gate's post-drain reload can still silently no-op — the race is
  narrowed, not closed.** `CollectionStore.load()` early-returns on
  `this.loading()` instead of awaiting, so a post-drain `load()` overlapping
  the startup load is skipped and the pre-drain card array survives. The
  awaited `drain()` costs a round-trip so the startup load has almost always
  settled, but the window is widest exactly where it matters. A real fix is for
  `load()` to return the in-flight promise. Same shape as **L-028**.
- **(Step 12) A "lint-only" pass leaked a behaviour change into an out-of-scope
  file.** Making `CollectionStore.suspendCard`/`unsuspendCard` callers
  lint-clean turned `Browser.toggleSuspend` synchronous, so its `busy` guard
  stopped awaiting the still-async `unsuspendCard` and the button re-enabled
  mid-request, losing double-click protection. `browser.ts` is in no step's
  `Files` list — pulled in purely as a caller. Caught by reading the diff;
  nothing covers the `busy` flag.
- **(Step 12) Two spec instructions were overruled by ESLint, with the user's
  explicit agreement**: Step 7's "keep every method `async`" (four methods now
  sync `void` — `require-await`; no behaviour change, but public signatures
  changed) and Step 11's `e.returnValue = ''` (deprecated; handler now calls
  `preventDefault()` only, which Chrome and Safari honour). **A step that pins
  an exact code shape can be invalidated by a lint rule the planner never ran.**

**Phase 4 input:**

- **(C-8) Client and server `card.modified` diverge permanently.**
  `POST /review` assigns `modified: Date.now()` server-side
  (`routes/index.ts:120`) and `rate()` discards the response
  (`review.ts:284`) — which is *why* D3 is safe. Pre-existing, not introduced
  here, and `modified` is exactly the field **Phase 4** wants for its staleness
  precondition. Phase 4 input, not a Phase 3 bug.
- **"Offline" here means a *running tab*, never a *cold load*.** With no
  service worker the shell, collection and media all come from Express. Network
  drops mid-session → keep studying, drains on reconnect. Reload or cold-start
  offline → browser error page, ops safe in `localStorage`. The second case is
  a PWA, which §3 puts out of scope.
- **A1 cannot hold for audio cards at all** — media is served by Express (7,241
  files) with no service worker, so a Listening card has no audio offline
  however well the outbox behaves. A1 is amended to **text cards only**.
