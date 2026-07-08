# CRITIQUE: 005-review-page-redesign
- **Mode:** drift
- **Date:** 2026-07-08
- **Verdict:** REVISE

## Findings

1. **[BLOCKER]** T002 and T003 are marked complete in STATE.md, but their code
   is not committed to the branch. `git diff main...HEAD --stat` shows only
   `web/src/app/features/review/review.ts` (T001, committed in `33960d4`).
   `review.html` and `review.scss` are uncommitted working-tree modifications
   and `review.spec.ts` is an untracked file — none of the three exist in any
   commit on `feature/review-page-design`. Per the plan's "Files affected"
   list and a branch-relative drift audit, the implementation for reqs
   1–10 and the entire test contract (reqs 3,5,8,9,10,11,12,13 per the
   testing-strategy table) currently has **zero committed evidence** — a
   fresh clone, stash, or force-push of this branch loses T002/T003
   entirely. STATE.md's "Completed" checklist and "Next action" both assert
   `npm run test`/`npm run build` are green including these files, but that
   was verified against an uncommitted working tree, not the branch. This
   must be committed (or STATE.md must not claim the tasks done) before the
   feature can move to `done`.

2. **[WARN]** Req 1 says the progress bar spans "the full width of the page
   at the very top." The shipped bar (`review.html:1-3`, `.progress-bar` in
   `review.scss`) is the first element inside `<app-review>`'s own template,
   which only occupies `.app-main` (viewport minus the sidebar) — it does
   not span the page edge-to-edge. STATE.md's Decisions log reinterprets
   "full width of the page" to mean "full width of the content column" (a
   plan-time call, not a SPEC.md amendment). That's a defensible
   implementation choice, but it silently narrows an explicit requirement
   rather than resolving it as a SPEC Open Question or updating the
   requirement text — a reader of SPEC.md alone would expect true
   full-viewport width.

3. **[WARN]** `review.spec.ts`'s "shows the note-type kind uppercased in the
   chip" test asserts
   `chip.textContent.trim().toUpperCase()).toBe('CLOZE')` — normalizing the
   actual DOM text to uppercase before comparing means this passes whether
   the rendered text is `cloze`, `Cloze`, or `CLOZE`. Req 5's uppercase
   requirement is actually delivered via CSS `text-transform: uppercase` on
   `.chip` (review.scss:150), so the visual result is correct today, but the
   test doesn't guard it — removing that CSS rule would not be caught. The
   breadcrumb test in the same file gets this right (asserts the raw,
   un-transformed text and relies on CSS separately); the chip test should
   follow that pattern instead.

4. **[NIT]** The "Discovered" race condition (`Review.init()`'s
   `decks().length === 0` check racing `AppComponent`'s unconditional
   `store.load()`) is real and correctly scoped as pre-existing and
   independent of this feature: `CollectionStore.load()`'s own
   `if (this.loading()) return` guard only prevents a second concurrent
   *call* to `load()`; the actual bug is that `Review` skips calling
   `load()` at all once `decks()` is non-empty, even if `cards()` hasn't
   resolved yet. STATE.md's claim that it reproduces on both pre- and
   post-change code (via `git stash`) is consistent with the code read
   here. Correct call to log and defer rather than fix inline — flagging
   only so it isn't lost in a future `/clear`.

5. **[NIT]** STATE.md's "Completed" checklist still has "Reviewed &
   verified" unchecked, consistent with this being that verification step.
   The `done` transition should wait on finding 1 being resolved (commit
   T002/T003, or correct STATE.md's task status) before that box is
   checked.

Spot checks of reqs 8, 9, 12, 13 against the (uncommitted) working-tree code
pass: the ratings row is always rendered with native `disabled` gating both
clicks and keys 1–4 pre-reveal; the Show-answer pill reserves layout space
via `visibility: hidden` rather than unmounting (no jump); Esc navigates
unconditionally without cancelling an in-flight `rate()`, matching req 12's
"must not error" and covered by a test; and `rate()`'s side effects
(optimistic apply, `/api/review` POST, `recordStudied`, `burySiblings`) are
unchanged. These are sound as authored — finding 1 is about them not being
committed, not about their correctness.
