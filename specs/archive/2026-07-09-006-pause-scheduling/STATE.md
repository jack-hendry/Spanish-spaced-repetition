# STATE: 006-pause-scheduling

## Status
- **Phase:** done   <!-- specify | plan | implement | done -->
- **Current task:** none — all tasks complete
- **Last updated:** 2026-07-09

## Original request
> Implement a "Pause scheduling" feature for this Anki-style Spanish spaced-repetition app (Angular SPA `web/` + thin Express server `server/`, npm workspaces).
>
> ARCHITECTURE INVARIANT (do not violate): the server never computes scheduling. All SM-2/FSRS math, due-date logic, and study-queue ordering live in `web/src/app/core/`. The server only owns card structure and persistence. `card.due` is overloaded by queue: a *day number* for `review` cards (see `todayNumber()` in `web/src/app/core/collection.store.ts`), *epoch MILLISECONDS* for `learning`/`relearning` cards, and a position index for `new` cards (time-independent).
>
> UNIT CORRECTION: this repo's `.claude/skills/scheduling-domain` doc currently claims learning-queue `due` is "epoch seconds" — that is WRONG and stale. Verified directly against code: `fsrs.ts` sets `due = ctx.now + delayMin * 60_000` and `study-queue.service.ts` compares `c.due <= ctx.now`, where `ctx.now = Date.now()` (epoch milliseconds, `review.ts`). Trust the code, not the doc. As part of this task, also fix the doc: change its "epoch seconds" claim for learning-queue `due` to "epoch milliseconds."
>
> CARD MODEL NOTE: cards have two separate fields — `type` (`new`/`learning`/`relearning`/`review`, unaffected by suspension) and `queue` (`new`/`learning`/`review`/`suspended` — becomes `suspended` when a card is suspended, which erases the review/learning distinction from `queue` alone). Always use `card.type`, never `card.queue`, to decide which due-shift rule applies to a card — this ensures suspended cards are shifted identically to their non-suspended counterparts and stay consistent if later un-suspended.
>
> GOAL: A global (not per-deck) pause toggle. While paused, no cards are served for study from any deck (review, learning, or new-card introduction all halt), but browsing/editing/adding notes still works normally. On unpause, every eligible card's due date shifts forward by exactly the paused duration, so studying resumes exactly as if no time had passed while paused.
>
> KEY MECHANISM (established by prior analysis — do not redesign this part): shifting is done ONCE on resume, not via a permanent "second clock." Because FSRS's retrievability calc (`fsrs.ts` `previewReview`) derives elapsed time purely as `ctx.today - (card.due - card.interval)`, shifting `card.due` forward by the pause delta makes elapsed-time math, interval spacing, and FSRS decay all come out correct automatically — with ZERO changes needed to `todayNumber()`, `ReviewContext`, or any file in `web/src/app/core/scheduling/` (`sm2.ts`, `fsrs.ts`, `scheduler-factory.ts`, `types.ts`). Do not touch those files.
>
> Because `due` means different things per queue, the pause delta must be computed in two representations:
> - Day-count delta for cards with `type === 'review'`: `todayNumber(resumedAt) - todayNumber(pausedAt)` (respects the existing `dayCutoffHour`, unchanged — do NOT add timezone/DST-aware cutoff logic, that's a separate out-of-scope change).
> - Millisecond delta for cards with `type === 'learning'` or `type === 'relearning'`: `resumedAt - pausedAt`, added DIRECTLY to `card.due` with NO unit conversion (both `due` and the delta are already epoch milliseconds).
> Cards with `type === 'new'` are NEVER included in the shift — their `due` is a position index unrelated to time.
> If the computed delta is zero or negative (same-day pause/resume, or clock skew), treat resume as a no-op for due-date shifting — never decrease any card's `due`.
>
> Add the matching delta to each eligible card's `due` — this must add the SAME delta to every affected card (not snap them all to the resume day), preserving relative spacing so cards don't artificially pile up on the resume day. Do not modify `revlog` entries, `card.interval`, `card.stability`, or `card.difficulty` — only `due` changes. Revlog must stay on real wall-clock time.
>
> DATA MODEL: Add exactly ONE new field to `Collection` in BOTH `server/src/models/index.ts` and `web/src/app/core/models/index.ts` (hand-mirrored, no codegen — keep identical in shape): `pausedAt: number | null`. Non-null means paused, and it holds the epoch-ms the pause began. Add the default (`pausedAt: null`) to `server/src/store/seed.ts`. Toggling to PAUSE is a single `patchCollection({ pausedAt: Date.now() })` call via the existing `PATCH /api/collection` route (already implemented — no new route needed for pausing). Pausing while already paused (`pausedAt` already non-null) is a no-op — do not overwrite an existing `pausedAt` with a new timestamp.
>
> RESUME PERSISTENCE (single request, specified write order — this is the critical design point): Add ONE new server endpoint, `POST /api/collection/resume`, that:
> 1. Accepts `{ cardUpdates: { id: string; due: number }[] }` — pre-computed by the client (all math stays in `web/core/`). The server performs NO date arithmetic — it only writes exactly the `due` values it's given.
> 2. Writes in this EXACT order: (a) first, persist all `cardUpdates` to the card store (`cards.json`); (b) only after that succeeds, set `collection.pausedAt = null` and persist `collection.json`. This order is mandatory because it defines the recovery behavior: if the process crashes between (a) and (b), the collection is left with `pausedAt` still non-null but cards already shifted. On next load (or next resume attempt), the client detects `pausedAt` still set and MUST re-attempt resume — recomputing the delta from the same unchanged `pausedAt` and a fresh `resumedAt`. Because `cardUpdates` carries absolute `due` values (not deltas), re-sending the same-shaped update is safe UNLESS the delta changed between attempts — to avoid a double-shift, the retry must recompute deltas from scratch using the ORIGINAL `pausedAt` (still stored, unchanged) so the resulting `due` values are correct regardless of how many times the shift is (re)applied, i.e. the shift calculation must be idempotent with respect to `pausedAt` (recomputing "current due should be as if `pausedAt` never advanced past `resumedAt`" is safe to repeat, since it does not depend on the card's already-shifted state).
> 3. The reverse order (clearing `pausedAt` before writing cards) is explicitly forbidden — it would leave `pausedAt = null` (looking resumed) while cards remain unshifted, with no signal left to retry.
> 4. Do NOT implement this as two separate HTTP calls (a bulk card-patch endpoint followed by a separate `patchCollection` call) — a failure between two independent calls is a strictly worse failure mode than the ordered single-endpoint approach above, since there the client can't even tell resume was attempted.
> 5. Concurrent/duplicate resume requests (e.g. a double-clicked button) are safe because payloads are absolute `due` values, not deltas — write it in a way where re-applying the same update twice converges to the same state. Still disable the resume button while a request is in flight as standard UX practice, but this isn't required for correctness.
> 6. This is the only bulk-write endpoint needed — the server has no other bulk endpoint today (everything else is single-card `PATCH /api/cards/:id`).
>
> STUDY QUEUE GATING: In `web/src/app/core/study-queue.service.ts`, add a pause guard at the top of `next()` (currently `next(ctx: ReviewContext): Card | null` at line ~94) that returns `null` immediately when `collection.pausedAt !== null`, before any of the 4 selection tiers run. Apply the same gate in `counts()` so displayed counts read zero. In `web/src/app/core/collection.store.ts`, the `ownCounts` computed signal (which `deckTree`'s rollup inherits from) must, while paused, iterate the DECK LIST (`this.decks()`, not `this.cards()`) so it returns an entry for every deck — including decks with zero cards — with every count forced to `{new: 0, learning: 0, review: 0}`.
>
> STREAK BEHAVIOR: Locate the existing streak-calculation logic (used by the heatmap/stats feature). Confirm — and add a test proving — that a gap of more than 1 day with zero revlog entries breaks the streak, since revlog is never touched by pause/resume and a paused period naturally produces such a gap. Do not modify the streak logic itself unless the test reveals it currently bridges gaps incorrectly (in which case, fix it to break on any zero-review day beyond a 1-day gap).
>
> UI:
> - Add a "Pause scheduling" / "Resume scheduling" toggle button in the deck-list route (`/`) header. This is the ONLY control that mutates pause state.
> - Add a persistent "Scheduling paused" banner shown app-wide (in the root/shell layout component that wraps all routes — identify the actual root component file in this codebase, e.g. `app.ts`/`app.html` or equivalent, and add it there) so it's visible regardless of which route the user is on. The banner is READ-ONLY status display — it is not clickable and does not itself toggle pause state.
> - Update the study/review empty state (`web/src/app/features/review/review.ts` + `review.html`, currently a single `finished` signal driving an "All done" block) to show a distinct paused message rather than conflating it with "no cards due right now."
>
> OUT OF SCOPE: timezone-aware (America/Toronto midnight) day-cutoff logic — this is a separate, larger change deferred to its own effort; use the existing `dayCutoffHour` fixed-offset math unchanged.
>
> VERIFY: worked example — a card last reviewed on day 95 with interval 5 has `due = 100`. Pause starts day 100 (`pausedAt` set). Resume on day 130 (30 real days later). New `due` must become 130. On the next FSRS review, `lastReviewDay = due - interval = 125`, `elapsed = today(130) - 125 = 5` — exactly matching the original interval. Confirm with a unit test.
>
> Also verify explicitly:
> - A learning card due "10 minutes from pause" shifts by the exact millisecond delta — NOT divided or multiplied by 1000. Add a test that would fail if someone mistakenly treated `due` as epoch seconds.
> - Relative due-date spacing between two cards is preserved after a shift.
> - A suspended review card (type `review`, queue `suspended`) is shifted identically to a non-suspended review card.
> - `new`-type cards never appear in the resume payload.
> - A same-day pause/resume (delta <= 0) leaves every `due` unchanged.
> - A simulated crash between step 2(a) and 2(b) of resume leaves `pausedAt` non-null with cards already shifted — and a subsequent resume retry using the same `pausedAt` does not double-shift (idempotent recompute).
> - A gap of more than 1 paused day breaks the study streak (per the STREAK BEHAVIOR section).
> - Pausing while already paused does not change `pausedAt`.
>
> Add colocated `*.spec.ts` tests for the due-shift calculation and the study-queue pause gate, following this repo's existing test conventions (pure-function specs run without a server/browser; server tests use vitest with temp-dir isolation). Fix the `.claude/skills/scheduling-domain` doc's incorrect "epoch seconds" claim as part of this change.

## Completed
- [x] Spec written
- [x] Spec approved (human)
- [x] Plan written
- [x] Plan approved (human)
- [x] T001 — Add `pausedAt` to the data model + seed
- [x] T002 — Pure due-shift function + spec
- [x] T003 — Study-queue pause gate + spec
- [x] T004 — Collection-store `ownCounts` gate while paused
- [x] T005 — Server resume endpoint + spec
- [x] T006 — Pause service (compute + snapshot + recover) + spec
- [x] T007 — Deck-list header toggle
- [x] T008 — App-shell banner + recovery-on-load wiring
- [x] T009 — Review paused empty state
- [x] T010 — Streak-gap test (no code change to `dayStreak`)
- [x] T011 — SKILL.md unit fix (docs only)
- [ ] Reviewed & verified (/code-review + /verify after last task)

## Drift audit (critic, 2026-07-09)
Verdict: **PASS WITH NOTES** (0 blockers, 1 WARN, 2 NITs). Every touched file
matches PLAN's "Files affected" list; every Decisions-log claim cross-checked
against the actual diff and holds up; `npm run build` + `npm run test` green
(server 24/24, web 172/172). Full findings in CRITIQUE.md.

WARN resolved: `data/spanish/collection.json` had unrelated local-dev churn
(bumped `modified`/`lastUnburyDay` timestamps from running the dev server
during manual testing, not a code change) — reverted with `git checkout --`
before closing out the feature.

## Feature complete
Pause/resume scheduling is implemented end-to-end: `pausedAt: number | null`
on `Collection`; pure due-shift calc (`pause-shift.ts`); study-queue +
collection-store pause gates; ordered `POST /api/collection/resume` endpoint
(cards written before `pausedAt` cleared, crash-safe via localStorage-snapshot
retry); deck-list pause/resume toggle; app-shell "Scheduling paused" banner;
paused empty state in review; streak-gap test; SKILL.md epoch-unit fix. All
11 tasks (T001-T011) done, colocated specs added throughout, full test suite
green.

## Decisions log
- 2026-07-09 (T001 implementation):
  - `pausedAt` was made a required field (`number | null`), not optional, on
    `Collection` in both `server/src/models/index.ts` and
    `web/src/app/core/models/index.ts` — matching the spec's `number | null`
    type exactly (unlike `lastUnburyDay?: number`, which predates this task
    and was left untouched). This required adding `pausedAt: null` to three
    pre-existing web test fixtures that construct `Collection` object literals
    (`app.spec.ts`, `core/heatmap.spec.ts`, `shared/heatmap/heatmap.spec.ts`)
    so the workspace still type-checks — a minimal knock-on fix, not scope
    creep, since `npm run build`/`npm run test` must stay green per the
    testing-playbook definition of done.
  - Added `server/src/store/seed.test.ts` (new file, colocated per
    testing-playbook conventions) with the fresh-seed assertion
    `store.getCollection().pausedAt === null`, isolated via `FileStore` on a
    temp dir with `debounceMs: 0`.
- 2026-07-09 (spec revision, human-directed):
  - D1: Do NOT fix the stale `Card.due` comment in `server/src/models/index.ts` — avoid scope creep. R19 fixes only SKILL.md.
  - D2: Pause/Resume toggle goes in a NEW header element at the top of the `/` deck-list route, not the shell sidebar.
  - D3 (resolves the critic's BLOCKER): crash-recovery is not a blind recompute. Shift computed once; absolute-`due` payload snapshotted to localStorage keyed by `pausedAt`; retry/recovery RE-SENDS the saved payload (absolute writes = idempotent, no double-shift); auto-resume-on-load only when a saved payload exists; server `expectedPausedAt` guard rejects stale payloads. One documented residual edge (user manually clears localStorage mid-crash) accepted. SPEC R11/R11a/R11b, T7/T7a/T7b.
- 2026-07-09 (T002 implementation):
  - Added `web/src/app/core/pause-shift.ts` exporting `computeResumeCardUpdates(coll, cards, resumedAt)`, importing `todayNumber` from `collection.store.ts` (read-only import, no edits to that file or anything under `core/scheduling/`).
  - Added colocated `web/src/app/core/pause-shift.spec.ts` covering T1–T6 exactly as specified, using a `card`/`collection` factory pattern matching `daily-limits.spec.ts`. T6 uses `resumedAt === pausedAt` (dayDelta = 0, msDelta = 0) since a same-day-but-later resume would still have msDelta > 0 per R8/R10 — that only zeroes the review-day-delta path, not the learning-ms-delta path, so an instantaneous resume is the correct case to exercise both deltas being non-positive simultaneously.
  - No deviations from PLAN.md's function signature or shift rules.
- 2026-07-09 (T003 implementation):
  - Added the pause gate as the very first line of `next(ctx)` and `counts(ctx)`
    in `web/src/app/core/study-queue.service.ts`: `if
    (this.store.collection()?.pausedAt != null) return null;` /
    `return { new: 0, learning: 0, review: 0 };` — before the existing session
    check and all 4 selection tiers, exactly as specified.
  - Added `web/src/app/core/study-queue.service.spec.ts` (new colocated spec;
    none existed before for this service) using `TestBed` with a real
    `CollectionStore` (its signals are set directly rather than faked, since
    `StudyQueueService` reads `store.collection()`, `store.decks()`,
    `store.cards()`, `store.deckOptions()`, `store.deckById()`,
    `store.optionsFor()` — faking all of those seemed more error-prone than
    using the real signal-based store, which needs no HTTP calls when driven
    only via its public signals for this test). Covers T10: paused →
    `next()` null and `counts()` all-zero, with an unpaused sanity check
    first proving the same session serves a real due card; a second test
    confirms unpaused behaviour is unchanged (new-card case) after the gate
    was added. No pre-existing study-queue tests existed to regress, but the
    T002 `pause-shift.spec.ts` and all other specs remain green.
  - No deviations from PLAN.md.
- 2026-07-09 (T004 implementation):
  - In `web/src/app/core/collection.store.ts`, `ownCounts` now checks
    `coll.pausedAt != null` right after the `!coll` guard: when paused, it
    iterates `this.decks()` (not `this.cards()`) and sets every deck's entry
    to `{ new: 0, learning: 0, review: 0 }`, then returns early — before the
    existing `todayNumber`/per-card loop. Unpaused path is untouched.
  - Added `web/src/app/core/collection.store.spec.ts` (new colocated spec;
    none existed before for this store), modelled on
    `study-queue.service.spec.ts`'s `TestBed`-with-real-store pattern. Covers
    a deck with cards (`d1`) and a deck with zero cards (`d2`, a subdeck of
    `d1` via `::` name), asserting: unpaused sanity check that `d1.own`
    reflects real counts; paused, both `d1` and `d2` have zero `own` and
    `total` (`total` covers the `deckTree` rollup, per the "done when"
    wording about the sidebar/rollup reading zero).
  - No deviations from PLAN.md.
- 2026-07-09 (T005 implementation):
  - Added `POST /api/collection/resume` to `server/src/routes/index.ts`
    (placed right after `PATCH /collection`). Guard is
    `if (coll.pausedAt == null || coll.pausedAt !== expectedPausedAt)` →
    responds `{ applied: false }` (200) without touching cards or the
    collection (covers both the mismatch case and the already-null case per
    R11b). Otherwise: (a) apply each `{id, due}` by id (only the `due` field
    is written; unknown ids skipped) and `await store.saveCards()`, then
    (b) set `coll.pausedAt = null` and `await store.saveCollection()`. No
    date arithmetic anywhere in the endpoint.
  - Added an awaited `saveCards()` to `server/src/store/file-store.ts`: it
    cancels any pending debounced cards write then `await this.flush('cards')`
    (PLAN's `this.flush('cards')` matched to the real private `flush` method;
    cancelling the debounce avoids a stale later rewrite). `saveCardsSoon()`
    is left untouched for the review hot path.
  - Added `server/src/routes/resume.integration.test.ts` (real Express +
    FileStore on a temp dir, `debounceMs: 0`, per the notes.integration.test
    pattern). 6 tests: T7 apply-once-then-reapply (no double-shift, other
    fields untouched); T7 crash recovery (cards pre-shifted + pausedAt still
    set → re-send converges and clears pause); T7b mismatched
    `expectedPausedAt` (no card altered, pausedAt unchanged); T7b already-null
    no-op; unknown-id skip; and a write-order test that wraps `saveCards`/
    `saveCollection` to assert cards.json holds the shifted `due` (and
    collection.json still shows the pause) at the instant the collection write
    begins — proving cards-before-collection ordering is genuinely enforced,
    not accidental.
  - No deviations from PLAN.md. Note: the endpoint returns
    `{ applied: boolean }` (a minor detail PLAN left unspecified beyond "200
    success"); harmless and useful for the client/tests.

- 2026-07-09 (T006 implementation):
  - Added `resume(payload)` to `web/src/app/core/api.service.ts` returning
    `Observable<{ applied: boolean }>` (matching the T005 endpoint's response
    shape), placed after `patchCollection`, matching the existing
    `http.post`/typed-wrapper style.
  - Created `web/src/app/core/pause.service.ts` (`providedIn: 'root'`,
    `inject()` DI) with `pause()`, `resume()`, `recoverOnLoad()`, and a shared
    private `applyResume(payload)`. `resume()` computes the shift once via
    `computeResumeCardUpdates(coll, cards, Date.now())`, snapshots
    `{ expectedPausedAt, cardUpdates }` to
    `localStorage['resume-pending:'+pausedAt]` BEFORE the POST, then delegates
    to `applyResume`. `recoverOnLoad()` reads the snapshot for the EXACT current
    `pausedAt` and re-sends it verbatim (never recomputes — the D3 crash-safety
    invariant); missing snapshot = stay paused, no resume issued; stale keys for
    other episodes are ignored, not pruned (R11a). On success `applyResume`
    clears the pause in the store signal, applies the shifted `due` to cached
    cards via `store.cards.update`, and removes the localStorage key.
  - Store mutation used the existing public `collection`/`cards` signals'
    `.set`/`.update` (the same pattern `unburyForNewDay`/`applyCard` use);
    no new store method was added since this task is service-layer only.
  - Added `web/src/app/core/pause.service.spec.ts` mocking `ApiService` via
    `{ provide: ApiService, useValue: ... }` with `vi.fn()` returning `of(...)`
    (no real HTTP), modelled on `study-queue.service.spec.ts`'s TestBed
    factory pattern. Covers T9 (already-paused → no patch), T7a (recover
    re-sends exact saved payload + clears key; no payload → no resume), plus a
    stale-key-ignored case, the running-pause happy path, and the resume happy
    path (snapshot → POST → pause cleared → cached card shifted). `localStorage`
    cleared in `beforeEach`/`afterEach`.
  - No deviations from PLAN.md.

- 2026-07-09 (T007 implementation):
  - Added a new `<header class="dashboard__header">` at the top of
    `web/src/app/features/deck-list/deck-list.html` with a single
    `.pause-toggle` button. Label is computed inline from
    `collection()?.pausedAt == null` ("Pause scheduling" / "Resume
    scheduling"); `[class.pause-toggle--active]` reflects paused state for
    styling; `[disabled]="busy()"`.
  - `web/src/app/features/deck-list/deck-list.ts`: injected `PauseService`
    (`inject()`, field style, matching `ApiService`/`CollectionStore`), added
    a local `busy = signal(false)`, and a `togglePause()` method — calls
    `pauseService.pause()` when unpaused (no `busy` gating needed, pause is a
    single quick PATCH per T006), or sets `busy` true/false around
    `pauseService.resume()` in a try/finally. This is the only pause-mutating
    control in the app, matching R15/D2.
  - `web/src/app/features/deck-list/deck-list.scss`: added
    `.dashboard__header` (flex, right-aligned) and `.pause-toggle` styles
    consistent with existing surface/border/radius tokens used elsewhere in
    this file (e.g. `.year-select`), plus a `--active` amber variant matching
    the existing `.streak-badge` amber treatment.
  - Added `web/src/app/features/deck-list/deck-list.spec.ts` (new; none
    existed for this component before), modelled on `review.spec.ts`'s
    TestBed-with-provider-overrides pattern but using the real
    `CollectionStore` (seeded directly, as in `app.spec.ts`) with a faked
    `ApiService.getRevlog()` and a faked `PauseService` (`vi.fn()` for
    `pause`/`resume`, no real HTTP). Three tests: unpaused → label "Pause
    scheduling" + click calls `pause()` only; paused → label "Resume
    scheduling" + click calls `resume()` only; button is disabled while a
    (manually deferred) `resume()` promise is in flight and re-enabled after
    it resolves.
  - No deviations from PLAN.md.

- 2026-07-09 (T008 implementation):
  - `web/src/app/app.ts`: injected `PauseService` (`inject()`, field style),
    added a `paused = computed(() => this.store.collection()?.pausedAt !=
    null)` signal for the read-only banner. Constructor now calls
    `pauseService.recoverOnLoad()` exactly once: if the collection wasn't
    loaded yet, chained after `store.load()` resolves
    (`.then(() => this.pauseService.recoverOnLoad())`); if it was already
    present (e.g. seeded directly, as tests do), called immediately —
    covering both the real app-boot path and the existing test-fixture
    pattern that bypasses `load()` to avoid the un-mocked
    `unburyForNewDay()` PATCH hang noted in `app.spec.ts`.
  - `web/src/app/app.html`: added `@if (paused()) { <div class="pause-banner"
    role="status">Scheduling paused</div> }` above `.app-shell`, outside
    `<router-outlet>` so it's visible on every route. Not clickable, no
    click handler — purely a read-only status display per R16/D2 (the
    deck-list header button from T007 is still the only pause-mutating
    control).
  - `web/src/app/app.scss`: added a minimal `.pause-banner` style
    (centered, `--color-accent` background, dark text) consistent with the
    existing `.study-all` accent-pill treatment in the same file.
  - `web/src/app/app.spec.ts`: added `PauseService` mock provider
    (`{ recoverOnLoad: vi.fn() }`) to the TestBed config; three new tests —
    banner renders when a seeded collection has `pausedAt` set, banner is
    absent when `pausedAt` is null, and `recoverOnLoad()` is called exactly
    once after component creation (seeded/already-loaded path).
  - Full suite green: `npm run test -w server` (24 tests) and
    `npm run test -w web` (169 tests, up from 166) both pass; also ran
    `npm run test` (root) to confirm no regressions.
  - No mockup exists for this feature (`specs/006-pause-scheduling/` has no
    `mockups/` dir), so the testing-playbook's screenshot-comparison step
    was not applicable — skipped per its own scope ("compare against the
    target mockup"; none exists).
  - No deviations from PLAN.md.

- 2026-07-09 (T009 implementation):
  - Added `paused = computed(() => this.store.collection()?.pausedAt != null)`
    to `web/src/app/features/review/review.ts`, following the same pattern as
    `deckName` computed signal.
  - Updated `web/src/app/features/review/review.html`: the existing `finished`
    block now branches on `paused()`. When paused, renders a new `.paused` div
    with "Scheduling is paused" heading and "Resume scheduling to continue
    studying." message. When not paused, renders the unchanged `.done` block
    with "All done" / "No more cards due in this deck right now."
  - Added two new tests to `web/src/app/features/review/review.spec.ts` under
    "paused empty state" describe block: one verifying the unpaused finished
    state renders "All done", another verifying the paused finished state
    renders "Scheduling is paused" (and both assertions check the `.done` /
    `.paused` selector and the heading text).
  - Full suite green: `npm run test` (root) passes all 24 server + 171 web tests.
  - No deviations from PLAN.md.

- 2026-07-09 (T010 implementation):
  - Added a single test case `breaks the streak across a gap of more than 1 day`
    to the existing `dayStreak` describe block in
    `web/src/app/core/stats.spec.ts`. The test asserts that
    `dayStreak([10, 11, 20], 20)` returns `1`, proving the function correctly
    breaks the streak when there is a gap of more than 1 day (8 days in this
    case) with zero reviews. This test case directly verifies the requirement
    that a paused period (which produces zero-review days in the revlog) breaks
    the streak.
  - The existing `dayStreak` implementation was correct and required no fixes:
    it walks backward from `today` and stops at the first day without reviews,
    which naturally breaks on any gap > 1 day.
  - Full suite green: `npm run test` (root) passes all 24 server + 172 web tests
    (172 = 171 from T009 + 1 new test).
  - No deviations from PLAN.md or SPEC.md.

## Discovered
- `npm run build -w server` (bare `tsc -p tsconfig.json`) failed on
  `server/src/routes/resume.integration.test.ts` (added in T005) with
  several `TS2571 'Object is of type unknown'` errors (untyped
  `.json()` responses) and one duplicate-key (`id` set both explicitly
  and via `...over` spread in the `card()` test factory). Found while
  verifying T008; fixed directly (not deferred) since `npm run build`
  must stay green per the testing-playbook definition of done: removed
  the redundant explicit `id:` in `card()`, and cast each
  `await res.json()` to `{ applied: boolean }` at its 7 call sites.
  `npm run build` (full workspace) and `npm run test -w server` (24
  tests) both verified green afterward. No behavior change to the
  resume endpoint itself — test-file-only fix.

## Next action
Feature complete. Run `/code-review` and `/verify` to satisfy the
"Reviewed & verified" checkbox, then this feature can be merged. Use
`/feature` to start something new.

## Blockers
(none)
