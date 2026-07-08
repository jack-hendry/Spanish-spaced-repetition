# CRITIQUE: 005-review-page-redesign
- **Mode:** plan
- **Date:** 2026-07-08
- **Verdict:** PASS WITH NOTES

## Traceability
Reqs 1–14 all map to tasks (1,2,4,6,7 → T002; 3,5,10 → T002+T003;
8,9 → T002+T003; 11 → preserved code + T003; 12 → T001+T003; 13,14 →
testing strategy + T003). No orphan tasks. Dependency order
T001→T002→T003 is sound. Every task has `Complexity:` and `Skills:`
lines; skills fit the file lists (all web/ files → angular-conventions;
all code-writing → testing-playbook; no scheduling/queue source is
modified). Verified against the repo: `CollectionStore.deckById`
(collection.store.ts:190), `noteType.kind` and `counts` refresh in
`loadNext()` (review.ts:126, 141), 1–4 gating on `revealed()`
(review.ts:243–255), `npm run shoot` (root package.json → tools/
shoot.mjs), and the accent token mapping in app.scss/styles.scss all
check out. Plan is 173 lines — within budget. No non-goal violations.

## Findings
1. **[WARN]** False premise for T003's `Complexity: high`. The plan
   (Approach, "Test location" bullet) and STATE.md both claim the new
   spec is "the repo's first TestBed component test — the existing web
   specs are pure-logic". `web/src/app/app.spec.ts` is already a full
   TestBed component test: `TestBed.createComponent(App)`, DOM
   assertions, `provideRouter`, store seeding. By the rubric T003 is
   one file following an existing pattern → medium, so /resume would
   route it to opus unnecessarily. Worse, the implementer is steered
   away from app.spec.ts, which documents a directly relevant gotcha
   (store.load() → unburyForNewDay() fires an un-mocked
   `PATCH /api/collection` that hangs the test harness — app.spec.ts:53–58).
2. **[WARN]** T003's mocking approach is incomplete for one of its own
   assertions. It says fakes are provided "via TestBed `providers`",
   but `SchedulerFactory.for()` is a static method on a non-injected
   class (scheduler-factory.ts; called at review.ts:150 and :200), so
   DI fakes cannot intercept it. The assertion "clicking one pre-reveal
   does not call the scheduler/API" needs a `vi.spyOn(SchedulerFactory,
   'for')` (or equivalent) that the plan doesn't mention. Relatedly,
   the `StudyQueueService` fake must expose an `options` object —
   review.ts non-null-asserts `this.queue.options!` at :149 and :198
   before any scheduler call, so an incomplete fake throws before the
   behaviour under test.
3. **[NIT]** The "Files affected" table lists `review.ts` only with
   T001's reasons, but T002's prose also modifies it (removing the
   `tags` field from `RenderState`). Add the T002 touch to the table
   entry so the drift audit's file list stays accurate.
4. **[NIT]** T001's instruction "as the first branch after the
   finished()/loading() guard" is correct but note the current first
   branch is the `-` suspend handler (review.ts:238); Esc must precede
   it, which the wording implies — just be exact during code review.
