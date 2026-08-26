# STATE: 005-review-page-redesign

## Status
- **Phase:** implement   <!-- specify | plan | implement | done -->
- **Current task:** none — all tasks complete
- **Last updated:** 2026-07-08

## Original request
> @web/src/app/features/review/ redesign this page to align with the images.  Note the space bar should reveal the answers.  The again, hard, good, and easy buttons should be slightly greded out   [Image #1] [Image #2]

(Two reference mockup screenshots were attached; described in SPEC.md.)

## Completed
- [x] Spec written
- [x] Spec approved (human)
- [x] Plan written
- [x] Plan approved (human)
- [ ] Reviewed & verified (/code-review + /verify after last task)
- [x] T001 (low): Component logic — deck path + note-type kind in RenderState, Router inject, Esc-to-exit in onKey
- [x] T002 (medium): Template + styles — top progress bar, header, legend, card panel with breadcrumb/chip, Show-answer pill, always-rendered dimmed ratings, hint line
- [x] T003 (medium): Create review.spec.ts — TestBed component contract tests (ratings inertness, keyboard, Esc, chrome text)

## Decisions log
- Chip label = note-type `kind` uppercased (CLOZE / STANDARD) — SPEC OQ1 proposal.
- Suspend kept (topbar button + hint mention); final hint text: "space to flip · 1–4 to grade · esc to exit · − suspend" — SPEC OQ2.
- "← Decks" back link kept, restyled unobtrusively — SPEC OQ3.
- Legend reuses accent tokens: new=blue, learning=red, review=green (matches sidebar counts) — SPEC OQ4.
- Type-in Enter-to-reveal exception stands; hint text and "space" chip do not vary per card type — SPEC OQ5.
- All-decks breadcrumb (critique WARN 1): shows the current card's own deck path via CollectionStore.deckById(card.deckId); header still "All decks — n of total".
- "Full width of the page" = full content column (.app-main); .review host drops max-width, inner sections stay ~700px centered — critique NIT 4.
- Pre-reveal inertness via native `disabled` attribute + CSS opacity; row always rendered so reveal causes no layout jump.
- New test file at web/src/app/features/review/review.spec.ts (.spec.ts naming per testing-playbook); app.spec.ts is already a TestBed component test in this repo, so T003 follows an existing pattern → re-rated medium per human decision agreeing with critic warning (routes to sonnet, not opus).
- T003 mocking note: SchedulerFactory.for() is static (not DI) — assert "no scheduler call pre-reveal" via spy/no-API-call rather than a provider fake; StudyQueueService fake must supply non-null `options`.
- T002: implemented the Show-answer pill as always-rendered but `visibility: hidden` + `disabled` post-reveal (rather than `@if`-removed), specifically so the reserved layout space keeps the ratings row from moving when the pill disappears (req 9's "no layout jump"). The `@if`/`@else` around the ratings block was removed entirely per the plan; ratings are now a single always-rendered block gated only by `[disabled]="!revealed() || busy()"`.
- T002: removed `RenderState.tags` and the `.breadcrumb__tag` markup/style entirely — the breadcrumb now shows only `s.deckPath.join(' · ')` per SPEC req 5; no test referenced tags so nothing needed updating for req 14.
- T002: no mockup image files exist under `specs/005-review-page-redesign/` (only the two prose "mockup-state" descriptions in SPEC.md, since the original screenshots were pasted into the chat that authored SPEC.md, not saved to disk) — the visual check in the "done when" was done by reasoning against the SPEC.md prose description and PLAN.md decisions log, not a pixel comparison against a saved image.
- T003: confirmed the `SchedulerFactory.for()` static-call mocking note from PLAN.md — `preview()` (called unconditionally in `loadNext()` for the interval-label previews) fires regardless of reveal state, so "pre-reveal click/keys don't grade" is asserted via `vi.spyOn(Sm2Scheduler.prototype, 'answer')` (only called from `rate()`) plus "no `ApiService.submitReview` call", not by spying on `SchedulerFactory.for` itself.
- T003 discovery (not a plan deviation, but load-bearing for the test file): this Angular app is zoneless (no `zone.js` dependency, no `provideZonelessChangeDetection` needed since there's nothing to opt out of) — `fixture.whenStable()` only tracks Angular's render scheduling, not the plain-promise chains in `Review.init()`/`loadNext()`/`rate()`. Added a `flushMicrotasks()` helper (`await new Promise(r => setTimeout(r, 0))`) in the spec, called after every action that triggers one of those async chains, before asserting on the DOM. Documented inline in the spec; worth folding into testing-playbook if a second TestBed component spec needs it.
- T003: used a full, realistic `DeckOptions` fake (mirroring `server/src/store/seed.ts`'s default) rather than a partial cast, because `Sm2Scheduler.preview()` (called during every `loadNext()`) dereferences `opts.new.steps` etc. — a `{ id, scheduler } as DeckOptions` partial cast throws at runtime inside the component under test.
- All five T003 coverage areas (ratings inertness/grading, keyboard gating, Esc navigation + safe in-flight `rate()`, and chrome text: breadcrumb/chip/legend/hint) pass; no existing test was deleted or had its assertions weakened.

## Discovered
- **Pre-existing race condition, out of scope for T002**: `Review.init()` (`web/src/app/features/review/review.ts`) only awaits `this.store.load()` `if (this.store.decks().length === 0)`. `AppComponent` (`web/src/app/app.ts`) *also* calls `void this.store.load()` unconditionally in its constructor. On a fresh full page load of `/study/:deckId`, both components' `load()` calls race; `CollectionStore.load()` sets `decks` before `cards` finish fetching, so if `Review`'s check runs after `AppComponent`'s `decks.set()` but before its `cards.set()`, `Review` skips its own `await load()` and calls `queue.startAll()`/`queue.start()` against an empty `cards()` signal — the session finds 0 cards in scope and immediately shows "All done" even when thousands of cards are due. Reproduced on both the pre-T002 code (verified via `git stash`) and the post-T002 code, so it predates this feature entirely. Worked around during T002's visual check by navigating client-side (home page load, then click a deck row) instead of a full page load to `/study/:id`, which avoids the race. Not fixed — flagged here per scope discipline; a real fix likely belongs in `Review.init()` (await `store.load()` unconditionally, or gate on a store-level `loaded` signal that's true only after both decks and cards resolve) or in `CollectionStore.load()` (a single in-flight promise other callers can await instead of firing a second full load).

## Next action
Drift-audit critic returned REVISE (1 blocker, 2 warnings) — see Blockers below and CRITIQUE.md. Phase stays at implement, not done, until the human decides how to resolve. Nothing further to implement code-wise; this is a process/documentation gate.

## Blockers
- **BLOCKER (critic drift audit)**: T002/T003 work (review.html, review.scss, review.spec.ts, plus review.ts edits) exists only as uncommitted working-tree changes — `git diff main...HEAD` shows only T001's review.ts edit as committed. Nothing has been pushed/committed for this feature beyond T001, so a stash/clone/force-push could silently lose T002/T003. Per repo convention, commits are only made when the user explicitly asks — flagging for the user to decide when/how to commit rather than committing unilaterally.
- **WARN**: SPEC req 1 says the progress bar spans "the full width of the page"; shipped behavior is full-width of the content column only (sidebar excluded) — a deliberate reinterpretation recorded in the Decisions log but never reflected back into SPEC.md's wording. Cosmetic spec/code mismatch, not a functional bug.
- **WARN**: T003's chip-uppercase test normalizes actual DOM text to uppercase before comparing expected vs actual, so it cannot catch a regression that removes the CSS `text-transform: uppercase` rule (only catches wrong underlying text, not wrong casing).
