# Critic review — 023 · Never lose a review in flight

## Round 1 — against `Analyst.md`, before `tasks.md` exists

Per `specs/TEMPLATE.md`: every claim about a type, a signature, or a
behaviour was checked by opening the file, not by re-reasoning from the
Analyst. Findings are numbered `C-N`; each says what changed.

---

### C-1 — Two numbers in the Analyst were unmeasured. Both now measured. (fixed)

L-027 ("an unmeasured saving may not exist; measure before writing the
justification down") applied to the storage-budget argument in **D2**, which
is the entire justification for choosing `localStorage`.

| Claim | Written | Measured |
|---|---|---|
| `revlog.ndjson` lines | 3,915 | **3,923** (`wc -l`) |
| Revlog line size | — | **192 B** mean (`wc -c / wc -l`) |
| Serialised `Card` | "~400–600 B per op" | **304 B** (`JSON.stringify(cards[0])`) |
| 200-card session | "≈300 KB" | **≈150 KB** — 200 × (304 + 192 + envelope ≈ 600 B) for the reviews, plus ~200 × 150 B of `daily` patches, plus burys at ~120 B each |

The conclusion survives — ~150 KB against a ~5 MB quota is a 30× margin — but
the Analyst now states the measured figures, not a guess that happened to be
conservative in the right direction.

### C-2 — **Blocking.** D6's gate is at the wrong level: `App` loads the collection before any drain can finish. (fixed)

`app.ts:51` runs `void this.store.load()` in the **constructor**,
unconditionally, at app start. `collection.store.ts:134` `load()` fetches
`/api/collection` *and* `/api/cards` and populates the card signal.

So on a reload with a non-empty outbox the sequence is:

1. `App` constructor fires `store.load()` → cards fetched **pre-drain**, i.e.
   without the pending reviews applied.
2. The drain finishes some time later.
3. `Review.init()` sees an empty outbox, passes D6's gate, and starts a
   session **against the stale card array already in memory**.

The card the user answered before the reload is back in the queue. D6 as
written ("refuse to start while ops are pending") does not catch this, because
by the time the gate is evaluated the ops are gone.

**Fix applied to D6:** the gate is *drain → then re-load the collection → then
start*, not merely "wait for empty". Note `load()` self-guards on
`this.loading()` (`collection.store.ts:135`) and returns immediately if a load
is already in flight, so "reload after drain" must be sequenced, not fired
optimistically alongside the first load.

### C-3 — `store.load()` itself issues writes, which now land in the outbox. (fixed — made explicit)

`load()` ends with `await this.unburyForNewDay()`
(`collection.store.ts:146`), and `unburyForNewDay` issues one
`PATCH /cards/:id` per buried card plus a `PATCH /collection
{lastUnburyDay}` (lines 295–311). §2 already lists both among the routed
calls, but the Analyst did not say that this makes *loading the collection* an
outbox-producing operation.

It is correct as designed — the local signals are updated before the awaits,
so the queue is right locally either way, and FIFO puts the unbury behind any
reviews left over from the previous session, which is the order that
converges. Made explicit in D1 so nobody "optimises" the unbury back onto the
direct path.

### C-4 — `PauseService.recoverOnLoad()` is a second writer outside the outbox. Recorded, not fixed.

`app.ts:51-53` calls `pauseService.recoverOnLoad()` on every start, and
`pause.service.ts:66` re-sends a saved `POST /collection/resume` payload —
which rewrites `due` on every card. That path is deliberately **out of scope**
(§3, "non-study writes"), so with a non-empty outbox there are two independent
writers to `cards.json` with no ordering between them.

Why it is not fixed here: `resume` is guarded by `expectedPausedAt`
(`routes/index.ts:66`) and no-ops unless the collection is genuinely paused at
the exact episode it was computed against, and pause/resume is a desktop
action. Widening scope to cover it would pull the whole non-study write
surface into a spec whose job is the review loop. → `## Discovered`.

### C-5 — The drain can lock the whole app out for 15 minutes. (fixed)

The roadmap's own Discovered log (2026-09-17) records that the tier-1 rate
limiter covers **all routes** at 20 failures per 15 minutes with
`skipSuccessfulRequests: true` (`app.ts:70-78`). A drain loop that retries a
failing op quickly burns that entire budget on its own, and the 429s that
follow apply to the app, not just the outbox — converting a transient network
blip into a 15-minute lockout, while the user watches a banner that says their
reviews are unsaved.

**Fix applied to D5:** backoff starts at 2s (not 1s), the first retry is never
immediate, `Retry-After` on a 429 is honoured when present, and a single op
never contributes more than a handful of failures per limiter window. The
`online` event may trigger an immediate drain; a *failure* may not.

### C-6 — D4's motivating case was understated. (fixed)

The Analyst justified the revlog dedupe as protection against "replay". The
case that actually forces it is narrower and more convincing: a POST the
server **applied successfully** whose response never arrived. The client
cannot distinguish that from a failure — it is obliged to retry, and the
server is obliged to absorb it. Without the dedupe, the single most likely
cellular failure mode produces a *duplicated* review rather than a lost one,
which is the same corruption wearing different clothes. Stated in D4.

### C-7 — The id `Set` grows without bound. Accepted, with the escape hatch named.

`FileStore.init()` reading the whole `revlog.ndjson` costs one pass over
753 KB today. At the measured rate (spec 022: median 118 reviews per active
day) ten years is ≈ 440 k lines ≈ 85 MB — a slow boot, not a failure, and
`readRevlog()` already does a full pass for `GET /revlog`. Keeping the full
set is correct and simple; the bounded escape hatch (retain only the last
N ids, since an outbox replay happens within hours, never months) is named in
D4 as a future optimisation and deliberately **not built**.

### C-8 — D3 is safe because the response is already discarded. (confirmed, no change)

Checked because "stop awaiting the POST" sounds lossy. `POST /review` returns
`cards[idx]` with a server-assigned `modified: Date.now()`
(`routes/index.ts:120`), and `rate()` (`review.ts:284`) does
`await lastValueFrom(this.api.submitReview(...))` and **throws the result
away**. Nothing downstream reads it. Dropping the await loses no information.

The side effect — client `modified` and server `modified` diverge permanently
— is pre-existing, not introduced here, and is exactly the field Phase 4 will
want for its staleness precondition. Noted in `## Discovered` as Phase 4
input.

### C-9 — The idempotency key is real. (confirmed, no change)

Verified rather than assumed, since D4 rests on it entirely:
`core/scheduling/sm2.ts:37` and `core/scheduling/fsrs.ts:52` both mint
`id: \`r${ctx.now}-${Math.random().toString(36).slice(2, 8)}\`` inside
`answer()`. The id is created **once by the scheduler**, not per HTTP attempt,
so a queued op retried ten times carries one id. `appendRevlog`
(`file-store.ts:216`) has exactly one caller (`routes/index.ts:122`), so the
dedupe has a single chokepoint.

---

## Round 1 verdict

One blocking finding (**C-2**), which changes the design rather than the
wording: D6's gate had to move from "outbox empty" to "outbox drained *and*
collection re-loaded". Two corrections that would have shipped a wrong
justification (C-1) or a self-inflicted outage (C-5). The rest confirm the
plan against the code.

`Analyst.md` has been updated for C-1, C-2, C-3, C-5 and C-6; C-4 and C-8 are
in its `## Discovered`. **`tasks.md` is not yet written** — per
`specs/TEMPLATE.md` it comes after a human has reviewed this.

---

### C-10 — **A2 was untestable as written.** (fixed, after round 1)

Raised by the user asking whether D3 *prevents* offline capability. It does
not — it is what creates it — but checking the question surfaced a real defect
one criterion over.

A2 read: "answering cards offline, then **reloading the tab while still
offline**, loses nothing: the outbox still reports the pending count after the
reload." That cannot happen. Verified 2026-09-18: there is no service worker
anywhere in `web/` (no `serviceWorker`/`ngsw`/`manifest.webmanifest` hits,
`@angular/service-worker` not in `web/package.json`). The app shell is served
by Express, so an offline reload gets a browser error page — nothing renders,
so nothing can "report the pending count". The criterion would have been
checked off on a run that could not be performed, or quietly reinterpreted by
whoever hit it.

A2 now asserts what is actually true and actually testable: kill the tab
offline, reconnect, load, and the ops are still there and drain. What A2 does
*not* claim is stated inline rather than left to be rediscovered.

**The underlying distinction, now in `## Discovered`:** D3 makes a *running
tab* network-independent. Nothing in this spec makes a *page load*
network-independent — that is a PWA, and §3 excludes it.

---

## Round 2 — against `tasks.md`

Per `specs/TEMPLATE.md`: for every step that assumes a type, a return value or
a signature defined elsewhere, **open that file and confirm it**. Where the
answer was a behaviour rather than a signature, it was *measured* rather than
reasoned about (L-016: a harden pass must re-derive, not re-reason).

Confirmed, no change needed: `FileStore.readRevlog()` exists and is reused by
Step 1 rather than re-parsing; `notes.integration.test.ts` has the harness
Step 2 copies; `Observable` is already imported in `api.service.ts` (Step 4);
`tools/pull-fly-state.sh` and `tools/archive_spec.py` exist (Steps 14, 16);
`RevlogEntry.id` is minted in `answer()`, not per attempt (Step 8's key).

### R-1 — **Blocking.** Step 8 would have broken `review.spec.ts` with a `TypeError`. (fixed)

Opened the file rather than assuming. `review.spec.ts:177` builds
`apiFake = { submitReview: vi.fn(() => of(card())) }` — **one method, nothing
else** — and asserts on it at lines 244 and 264.

Once `Review` injects `OutboxService`, the real root service is constructed
over that same `apiFake`, and `drain()` calls `this.api.send(...)`, which does
not exist on it. That is a `TypeError` mid-drain, not a clean assertion
failure, and the executor would have spent the step debugging the wrong thing.
Worse, an enqueue in a test would write to the **shared** `localStorage`
(present in this env — see R-2) and leak across tests.

Step 8 previously said only "update it to assert the enqueue", which does not
cover this. It now prescribes the fix literally: provide an `OutboxService`
fake in the TestBed (`enqueue`/`drain`/`pendingCount`) rather than extending
`apiFake`, rewrite lines 244/264 against `outboxFake.enqueue` preserving each
assertion's sense, and add `load` to `storeFake` for Step 10. This is the
`HabitService.add()` defect class from L-018 — one `grep` at planning time.

### R-2 — Two DI assumptions in Steps 7/11 were speculation. Measured instead. (fixed)

Steps 11's "If blocked" guessed that `app.spec.ts` might fail for want of
`localStorage`, and Step 7 asserted `collection.store.spec.ts` would need
assertion updates. Both were guesses about an environment nobody had checked.

A throwaway probe spec (a root `@Injectable` injecting `ApiService`, run
through `npm run test -w web`, then deleted — 217 tests, then back to 216)
established:

- a root-provided service that injects `ApiService` **does** resolve under a
  bare `TestBed.configureTestingModule({})`;
- `localStorage` and `window` both exist in this test env.

So the real `OutboxService` constructs fine in `app.spec.ts` and Step 11 needs
no new provider — the old advice, while harmless, was unverified. And
`collection.store.spec.ts` mocks no `ApiService` method at all and never
mentions `patchCard`/`patchDeck`/`patchCollection`, so Step 7 should not touch
it; the step now says an unexplained edit there is a scope leak. Both steps
now state the measurement and its date.

The same measurement is what makes R-1 a real defect rather than a hypothetical
one: `localStorage` being present is precisely why an unfaked outbox would leak
between tests.

### R-3 — **Blocking.** `specs/STATE.md` is already at its budget; Step 15 would have deadlocked at the end. (fixed)

`python3 tools/state_rotate.py --check` reports **"300 lines, budget 300 — ok"**.
It passes *today* and fails the moment Step 15 adds `AD-029`. Gate 4 runs on
**every** push, not just archive pushes, so the failure would land at the very
end — with all the code written, the verification done, and the push refused.

Step 15's "If blocked" made it worse: it said to report and stop, which is a
deadlock, not a resolution. Rotation is explicitly not the step's to perform —
`CLAUDE.md`: `--apply` "is run by a human who has decided to rotate; no hook
ever runs it for you."

Step 15 now checks the budget **first**, before editing `STATE.md`, and asks
the user to rotate if there is no room — with an explicit instruction not to
trim someone else's entries to make space. A gate discovered at planning time
costs one sentence; discovered at push time it costs a session.

---

## Round 2 verdict

Two blocking findings, both of the same species: the plan was right about the
design and wrong about the ground it stood on. R-1 and R-3 would each have
stopped a run mid-flight — R-1 around Step 8 of 16, R-3 at Step 15 of 16 with
everything already built. R-2 replaced two guesses with one measurement.

`tasks.md` is updated for R-1, R-2 and R-3. **No code has been written.**
