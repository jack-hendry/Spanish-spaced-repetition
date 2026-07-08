# STATE: 005-review-page-redesign

## Status
- **Phase:** implement   <!-- specify | plan | implement | done -->
- **Current task:** T002 (next — template + styles)
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
- [ ] T002 (medium): Template + styles — top progress bar, header, legend, card panel with breadcrumb/chip, Show-answer pill, always-rendered dimmed ratings, hint line
- [ ] T003 (medium): Create review.spec.ts — TestBed component contract tests (ratings inertness, keyboard, Esc, chrome text)

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

## Discovered
(empty)

## Next action
T001 complete (Router injection, RenderState fields, Esc navigation). Tests and build passing. Ready to /resume for T002 (template + styles redesign).

## Blockers
(none)
