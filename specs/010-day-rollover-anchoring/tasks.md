# tasks: 010-day-rollover-anchoring

**8 steps, in order, do not skip ahead.** Every step ends at a green build and
a green suite — there is no deliberately-red step. Redness is proved once, in
Step 5, by stashing the fix rather than by leaving the tree broken.

Baseline before Step 1: `npm run test -w web` → **21 files, 209 tests passing**;
`npm run lint:ci` exits 0.

**Measured during planning, so no step needs to discover it:** applying Step 1's
change alone leaves all 209 existing tests passing and lint clean. No existing
spec asserts an absolute day number, so **no test may be re-baselined**. If any
existing test goes red in Step 1, that is a real regression — stop and report,
do not adjust the test.

---

### Step 1 — Re-anchor `todayNumber` to local calendar days

**Model:** haiku

**Status:** done (2026-09-01, `npm run test -w web` 21 files / 209 tests pass, `lint:ci` 0, `grep -c studyDayIndex` = 3, `grep -c 'now - collection.created'` = 0)

**Files**
- MODIFY `web/src/app/core/collection.store.ts` — anchor: `export function todayNumber` (~line 27)
- DO NOT TOUCH: `web/src/app/core/heatmap.ts`, anything under `server/`, any
  `*.spec.ts` (tests come in Steps 2–4), any other file in `web/src`.

**Context**
`todayNumber` currently subtracts the raw `created` epoch instant, which anchors
the daily rollover to `created`'s time-of-day rather than to a fixed local
wall-clock hour. Replace it with a count of local calendar days between the
study day of `created` and the study day of `now`. The shift must be applied in
local **wall-clock** hours (`Date.prototype.setHours`), not by subtracting
absolute milliseconds — that is what makes the boundary land at exactly
`cutoffHour`:00 on DST-transition days too. `Date.UTC(y, m, d)` of the resulting
local calendar date turns it into a whole-day index with no DST arithmetic in it.

**Do**
1. In `web/src/app/core/collection.store.ts`, immediately above the exported
   `todayNumber`, add this module-private helper, verbatim:

   ```ts
   /**
    * The whole-day index of the local calendar day `ms` belongs to, once the
    * day is shifted to begin at `cutoffHour`:00 local. The shift uses local
    * wall-clock hours, so the boundary is exactly `cutoffHour`:00 on every
    * date, DST transitions included.
    */
   function studyDayIndex(ms: number, cutoffHour: number): number {
     const d = new Date(ms);
     d.setHours(d.getHours() - cutoffHour);
     return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
   }
   ```

2. Replace the body of `todayNumber` so it reads, verbatim:

   ```ts
   /**
    * Study-day number: local calendar days from the study day containing
    * `collection.created` (day 0) to the study day containing `now`. Rolls
    * over at `collection.dayCutoffHour`:00 local, independent of what
    * time-of-day the collection happened to be created.
    *
    * NOTE: this and `heatDateKey` (`core/heatmap.ts`) bucket the timeline
    * identically on ordinary days, but `heatDateKey` shifts by absolute hours,
    * so on the two DST-transition days a year the two boundaries sit up to an
    * hour apart. Deliberate — see specs/010-day-rollover-anchoring.
    */
   export function todayNumber(collection: Collection, now = Date.now()): number {
     return (
       studyDayIndex(now, collection.dayCutoffHour) -
       studyDayIndex(collection.created, collection.dayCutoffHour)
     );
   }
   ```

3. Do not change `todayNumber`'s signature, export, or call sites.

**Done when**
- `npm run test -w web` — **21 files, 209 tests pass** (identical to baseline;
  no test edited, none skipped).
- `npm run lint:ci` exits 0.
- `grep -c 'studyDayIndex' web/src/app/core/collection.store.ts` returns `3`
  (the definition plus its two call sites).
- `grep -c 'now - collection.created' web/src/app/core/collection.store.ts`
  returns `0` — the old formula is gone.

**If blocked**
If any of the 209 existing tests fails, STOP and report which one with its
assertion output. Do not edit the test to make it pass — planning measured this
change as leaving all 209 green, so a failure means the edit differs from the
one above.

---

### Step 2 — Pin the boundary, the origin, and the pre-cutoff `created` edge (R1–R4)

**Model:** haiku

**Status:** done (2026-09-01, `npm run test -w web` 21 files / 213 tests pass, `lint:ci` 0)

**Depends on:** Step 1 — asserts the behaviour Step 1 implements.

**Files**
- MODIFY `web/src/app/core/collection.store.spec.ts` — anchor: the existing
  `function collection(over: Partial<Collection> = {}): Collection` factory at
  the top (~line 7); append the new `describe` at the end of the file.
- DO NOT TOUCH: `web/src/app/core/collection.store.ts`, any other spec file.

**Context**
The file already has a `collection(over)` factory defaulting to `created: 0`,
`dayCutoffHour: 4`. Reuse it — pass `created` as a **locally constructed**
date (`new Date(y, m, d, h, min).getTime()`) so the host timezone cancels on
both sides of the subtraction and no TZ mocking is needed (this is 007's
precedent). Months are 0-indexed: June 2026 is month `5`, September is `8`.
Assert *deltas and equalities*, never a hard-coded absolute day number.

**Do**
1. Append to `web/src/app/core/collection.store.spec.ts`:

   ```ts
   describe('todayNumber day rollover', () => {
     const CREATED = new Date(2026, 5, 24, 10, 20, 35).getTime();
     const at = (y: number, m: number, d: number, h: number, min = 0) =>
       new Date(y, m, d, h, min).getTime();

     it('rolls over at dayCutoffHour:00 local, not at created’s time-of-day', () => {
       const coll = collection({ created: CREATED, dayCutoffHour: 4 });
       const before = todayNumber(coll, at(2026, 8, 1, 3, 59));
       const after = todayNumber(coll, at(2026, 8, 1, 4, 1));
       expect(after - before).toBe(1);
       // Still the same day well past created's 10:20 time-of-day.
       expect(todayNumber(coll, at(2026, 8, 1, 14, 30))).toBe(after);
       expect(todayNumber(coll, at(2026, 8, 1, 23, 59))).toBe(after);
     });

     it('ignores created’s time-of-day', () => {
       const early = collection({ created: at(2026, 5, 24, 5, 0), dayCutoffHour: 4 });
       const late = collection({ created: at(2026, 5, 24, 23, 45), dayCutoffHour: 4 });
       const now = at(2026, 8, 1, 10, 30);
       expect(todayNumber(early, now)).toBe(todayNumber(late, now));
     });

     it('numbers the study day containing created as day 0', () => {
       const coll = collection({ created: CREATED, dayCutoffHour: 4 });
       expect(todayNumber(coll, CREATED)).toBe(0);
       expect(todayNumber(coll, at(2026, 5, 24, 4, 0))).toBe(0);
       expect(todayNumber(coll, at(2026, 5, 24, 23, 59))).toBe(0);
       // 03:00 that date is still the previous study day.
       expect(todayNumber(coll, at(2026, 5, 24, 3, 0))).toBe(-1);
     });

     it('treats a created before the cutoff hour as the previous calendar day', () => {
       const coll = collection({ created: at(2026, 5, 24, 2, 0), dayCutoffHour: 4 });
       // Day 0 runs Jun 23 04:00 -> Jun 24 04:00.
       expect(todayNumber(coll, at(2026, 5, 23, 12, 0))).toBe(0);
       expect(todayNumber(coll, at(2026, 5, 24, 3, 59))).toBe(0);
       expect(todayNumber(coll, at(2026, 5, 24, 4, 1))).toBe(1);
     });
   });
   ```

2. Add `todayNumber` to the existing `import { CollectionStore } from './collection.store';`
   line so it reads `import { CollectionStore, todayNumber } from './collection.store';`.

**Done when**
- `npm run test -w web` — **21 files, 213 tests pass** (209 + 4).
- `npm run lint:ci` exits 0.

**If blocked**
If any new test fails, STOP and report the actual vs expected values. Do not
weaken an assertion — a failure here means Step 1's edit is not the one
specified.

---

### Step 3 — Pin one-to-one calendar mapping and heatmap agreement (R5, R10)

**Model:** haiku

**Status:** done (2026-09-01, `npm run test -w web` 21 files / 215 tests pass, `lint:ci` 0; 400-day walk -174 → 225, all deltas 1)

**Depends on:** Step 2 — extends the same `describe('todayNumber day rollover')`
block and reuses its `at` helper and `CREATED` constant.

**Files**
- MODIFY `web/src/app/core/collection.store.spec.ts` — anchor:
  `describe('todayNumber day rollover'`
- DO NOT TOUCH: `web/src/app/core/heatmap.ts`, `web/src/app/core/heatmap.spec.ts`,
  `web/src/app/shared/heatmap/heatmap.spec.ts`, `web/src/app/core/collection.store.ts`.

**Context**
R5 says day numbers map one-to-one onto local calendar days. The test must walk
a **full year** of consecutive dates so that on a DST host it really crosses both
transitions, and so that on a UTC CI host it still asserts the property instead
of passing vacuously. R10 says `todayNumber` and `heatDateKey` bucket the
timeline identically on ordinary days; the DST-transition days are the known,
accepted exception, so the agreement test must skip them rather than pretend
they agree. `heatDateKey` is exported from `web/src/app/core/heatmap.ts` and
must not be modified.

**Do**
1. Inside the existing `describe('todayNumber day rollover')` block, append:

   ```ts
     it('advances by exactly one per local calendar date across a full year', () => {
       const coll = collection({ created: CREATED, dayCutoffHour: 4 });
       let prev: number | null = null;
       for (let i = 0; i < 400; i++) {
         // Local noon on each consecutive date; noon is safely past any cutoff
         // and clear of both DST transition hours.
         const t = todayNumber(coll, new Date(2026, 0, 1 + i, 12).getTime());
         if (prev !== null) expect(t - prev).toBe(1);
         prev = t;
       }
     });

     it('shares heatDateKey’s day boundaries on non-DST-transition days', () => {
       const coll = collection({ created: CREATED, dayCutoffHour: 4 });
       // Two consecutive ordinary dates, sampled either side of the cutoff.
       for (const [y, m, d] of [
         [2026, 8, 1],
         [2026, 8, 2],
       ] as const) {
         const beforeCutoff = new Date(y, m, d, 3, 59).getTime();
         const afterCutoff = new Date(y, m, d, 4, 1).getTime();
         expect(todayNumber(coll, afterCutoff) - todayNumber(coll, beforeCutoff)).toBe(1);
         expect(heatDateKey(afterCutoff, coll.dayCutoffHour)).not.toBe(
           heatDateKey(beforeCutoff, coll.dayCutoffHour),
         );
         const later = new Date(y, m, d, 20).getTime();
         expect(todayNumber(coll, later)).toBe(todayNumber(coll, afterCutoff));
         expect(heatDateKey(later, coll.dayCutoffHour)).toBe(
           heatDateKey(afterCutoff, coll.dayCutoffHour),
         );
       }
     });
   ```

2. Add `import { heatDateKey } from './heatmap';` to the spec's import block,
   keeping the existing import ordering the linter enforces.

**Done when**
- `npm run test -w web` — **21 files, 215 tests pass** (213 + 2).
- `npm run lint:ci` exits 0.
- `git diff --name-only -- web server` lists exactly
  `web/src/app/core/collection.store.spec.ts` and
  `web/src/app/core/collection.store.ts` (the latter from Step 1) — nothing
  under `server/`, and no heatmap file.

**If blocked**
If the 400-day walk fails, STOP and report the first date where the delta was
not 1, with both day numbers. Do not shorten the loop or skip the failing date.

---

### Step 4 — Regression test for the reported symptom

**Model:** haiku

**Status:** done (2026-09-01, `npm run test -w web` 21 files / 216 tests pass, `lint:ci` 0)

**Depends on:** Step 2 — reuses the `at` helper and the `collection()` factory.

**Files**
- MODIFY `web/src/app/core/collection.store.spec.ts` — anchor:
  `describe('todayNumber day rollover'`; add a new sibling `describe` after it.
- DO NOT TOUCH: `web/src/app/core/daily-limits.ts`,
  `web/src/app/core/daily-limits.spec.ts`, `web/src/app/core/collection.store.ts`.

**Context**
This is the bug as the user hit it: study in the evening, come back the next
morning, get zero new cards. It needs `todayNumber` and
`remainingLimits`/`dailyForToday` together, which is why it lives here and not
in `daily-limits.spec.ts` (that file deliberately stays a pure function of plain
numbers). `remainingLimits(decks, subtree, today, opts)` is exported from
`./daily-limits`; the spec file already has a `deck()` and a `deckOptions()`
factory — reuse them, and set the deck's `daily` via the factory's `over`
argument.

**Do**
1. Append to `web/src/app/core/collection.store.spec.ts`:

   ```ts
   describe('daily allowance across a calendar-day boundary', () => {
     it('restores the full new-card allowance the morning after an evening session', () => {
       const created = new Date(2026, 5, 24, 10, 20, 35).getTime();
       const coll = collection({ created, dayCutoffHour: 4 });

       // Evening session on Aug 31, after created's 10:20 time-of-day.
       const evening = new Date(2026, 7, 31, 17, 55).getTime();
       const studiedDay = todayNumber(coll, evening);
       const d = deck({ id: 'd1', daily: { day: studiedDay, newStudied: 20, reviewStudied: 0 } });
       const opts = deckOptions();

       // Same evening the cap is spent.
       expect(
         remainingLimits([d], new Set(['d1']), studiedDay, opts).newRemaining,
       ).toBe(0);

       // Next morning at 10:30 the tally is stale and the allowance is back.
       const nextMorning = todayNumber(coll, new Date(2026, 8, 1, 10, 30).getTime());
       expect(nextMorning).toBe(studiedDay + 1);
       expect(
         remainingLimits([d], new Set(['d1']), nextMorning, opts).newRemaining,
       ).toBe(opts.new.perDay);
     });
   });
   ```

2. Add `import { remainingLimits } from './daily-limits';` to the spec's import
   block, keeping the linter's import ordering.

**Done when**
- `npm run test -w web` — **21 files, 216 tests pass** (215 + 1).
- `npm run lint:ci` exits 0.

**If blocked**
If `deck()`'s `over` argument does not accept `daily`, STOP and report — it
means `Deck`'s type or the factory differs from what this step assumed. Do not
add a cast or widen the factory's type.

---

### Step 5 — Checkpoint: prove the new tests are live, then re-verify everything

**Model:** haiku

**Status:** done (2026-09-01, exactly the 6 predicted tests red under the old formula and the 400-day walk green; after restoring, root `npm run test` = 71 server + 216 web, `npm run build` clean, `lint:ci` 0)

**Depends on:** Steps 1–4 — this is the checkpoint over all of them.

**Files**
- DO NOT TOUCH: any file. This step makes no lasting edit. Its temporary edit
  to `web/src/app/core/collection.store.ts` MUST be reverted before it reports.

**Context**
A new test that passes against the old code proves nothing (L-006). This step
temporarily restores the old `todayNumber` body, records which of the 7 new
tests go red, then puts Step 1's version back. Use a plain file edit and
`git checkout --` to restore — **do not use `git stash`**: the stash stack is
shared with other worktrees (`CLAUDE.md`, working agreement).

**Measured during planning — this is the expected result, not a guess.** Under
the old formula **exactly 6 of the 7 new tests fail**. The seventh, `advances by
exactly one per local calendar date across a full year`, **stays green**: the old
formula is a fixed 86,400,000 ms grid, which also advances once per calendar day
when sampled at local noon, because noon is eight hours clear of the boundary and
a DST hour of drift never pushes it across. That test therefore guards the
one-to-one property against a *future* regression but does not discriminate
between the two formulas — say so in the report rather than treating its
greenness as a defect.

**Do**
1. In `web/src/app/core/collection.store.ts`, temporarily replace **only the
   body** of `todayNumber` with the pre-fix formula, leaving the
   `studyDayIndex` helper and both doc-comments in place:
   ```ts
     const cutoffMs = collection.dayCutoffHour * 3600_000;
     return Math.floor((now - collection.created - cutoffMs) / 86_400_000);
   ```
   (ESLint will now flag `studyDayIndex` as unused. Expected, and temporary —
   do not run `lint:ci` in this state.)
2. Run `npm run test -w web` and record the exact names of the failing tests.
3. Restore Step 1's two-line body by editing the file back — **not** with
   `git checkout --`, which would also discard Step 1's helper and comments,
   and **not** with `git stash`, whose stack is shared across worktrees
   (`CLAUDE.md`, working agreement).
4. Re-run the full suites and the build.

**Done when**
- The temporary-revert run reports **exactly 6 failing tests**, and they are:
  `rolls over at dayCutoffHour:00 local, not at created’s time-of-day`,
  `ignores created’s time-of-day`,
  `numbers the study day containing created as day 0`,
  `treats a created before the cutoff hour as the previous calendar day`,
  `shares heatDateKey’s day boundaries on non-DST-transition days`,
  `restores the full new-card allowance the morning after an evening session`.
  Report the list verbatim.
- After restoring: `npm run test` from the repo root — server suite unchanged
  and **21 files, 216 web tests pass**.
- `npm run build` completes with no error.
- `npm run lint:ci` exits 0.
- `git diff -- web/src/app/core/collection.store.ts` shows only the
  `studyDayIndex` helper plus the rewritten `todayNumber` — nothing else.

**If blocked**
If any test other than the 400-day walk stays green under the old formula, STOP
and report which. A new test that passes against the pre-fix code is not pinning
anything (L-006) and must be rewritten, not accepted.

---

### Step 6 — Correct the two docs that state the old day-number definition

**Model:** haiku

**Status:** done (2026-09-01, all three greps return no matches; scope check lists exactly 4 files. Follow-up: the 2026-08-31 lesson's opening quote was rewritten as history after the main-section edit made it stale — the same L-001 trap this step exists to close)

**Depends on:** Step 1 — both docs must describe the formula Step 1 landed.

**Files**
- MODIFY `.claude/skills/scheduling-domain/SKILL.md` — anchors: the
  `## Day numbers` heading (~line 36) and the `### 2026-08-31 — Heatmap buckets
  key by calendar date shifted by \`dayCutoffHour\`` lesson (~line 209)
- MODIFY `CLAUDE.md` — anchor: `"Day number" = days since collection creation`
- DO NOT TOUCH: `specs/**` (the session owns those), any file under `web/` or
  `server/`.

**Context**
`SKILL.md`'s `## Day numbers` section quotes the pre-fix formula verbatim, so it
goes stale the moment Step 1 lands — exactly the L-001 failure mode ("a doc that
contradicts the code is worse than no doc; it gets copied"). Its 2026-08-31
auto-appended lesson also carries a rationale — "`todayNumber` is for
comparisons that must respect creation time" — which this feature makes wrong:
after Step 1, `todayNumber` deliberately does *not* respect creation time-of-day.
The lesson's `## Lessons (auto-appended)` preamble says: "If a lesson
contradicts the body above, trust the code, then fix both." Fix both.

**Do**
1. In `.claude/skills/scheduling-domain/SKILL.md`, replace the body of
   `## Day numbers` with a description of the landed behaviour: local calendar
   days from the study day containing `collection.created` (day 0), rolling over
   at `collection.dayCutoffHour`:00 **local wall-clock time**, independent of
   `created`'s time-of-day. Keep the existing "must go through `todayNumber`,
   never through calendar dates" guidance and the pointer to
   `web/src/app/core/collection.store.ts`.
2. In the same file's 2026-08-31 lesson, correct the final "**Corrected rule:**"
   sentence: the distinction is no longer "`todayNumber` respects creation time".
   State it as it now is — `todayNumber` counts *study days* (an integer that
   persisted `card.due` values are compared against), `heatDateKey` produces a
   *calendar-date key* for the visual grid; both roll over at `dayCutoffHour`,
   and they differ only in that `heatDateKey` shifts by absolute hours while
   `todayNumber` shifts by wall-clock hours, so their boundaries sit up to an
   hour apart on the two DST-transition days a year. Add a dated line noting
   spec 010 as the change. Do not delete the existing lesson — it is
   append-only history; correct the one wrong sentence and append the note.
3. Update the `Verified against source` date at the top of `SKILL.md` to
   `2026-09-01`.
4. In `CLAUDE.md`, update the `"Day number" =` clause in the "Data model
   essentials" section so it says local calendar days since the study day of
   `collection.created`, rolling over at `collection.dayCutoffHour` local
   (default 4am, like Anki). Leave the rest of that bullet, including the
   AD-003/L-001 references, untouched.

**Done when**
- `grep -n 'now - collection.created' .claude/skills/scheduling-domain/SKILL.md`
  returns **no matches**.
- `grep -n 'respect creation time' .claude/skills/scheduling-domain/SKILL.md`
  returns **no matches**.
- `grep -n 'days since collection creation' CLAUDE.md` returns **no matches**.
- `git diff --name-only -- CLAUDE.md .claude web server` lists exactly
  `.claude/skills/scheduling-domain/SKILL.md`, `CLAUDE.md`,
  `web/src/app/core/collection.store.ts` and
  `web/src/app/core/collection.store.spec.ts` — four files, no more.
  (Scope the path list; a bare `git diff --name-only` also lists the
  `specs/010-day-rollover-anchoring/` docs the session owns.)

**If blocked**
If either grep still matches after the edit, STOP and report the remaining line.
Do not delete surrounding content to make a grep pass.

---

### Step 7 — Confirm the live store is untouched (R7)

**Model:** haiku

**Status:** done (2026-09-01, `git status --porcelain -- data/spanish/` and `-- server/` both empty; `git diff --stat -- server/` empty)

**Depends on:** Steps 1–6 — checks that none of them wrote to the data store.

**Files**
- DO NOT TOUCH: anything. This step is read-only verification.

**Context**
`data/spanish/` is live state that the running dev server rewrites on every
review, so it dirties the tree on its own (L-002). R7 requires that this
feature writes nothing there. This step separates "the feature wrote to it"
from "a dev server was running", by checking the tree rather than reasoning
about it.

**Do**
1. Run `git status --porcelain -- data/spanish/`.
2. If it reports anything, run `git diff --stat -- data/spanish/` and report
   exactly which files differ and by how much, then run
   `git checkout -- data/spanish/` and re-check.
3. Run `git diff --stat -- server/` and confirm it is empty.

**Done when**
- `git status --porcelain -- data/spanish/` prints nothing.
- `git status --porcelain -- server/` prints nothing.
- `git status --porcelain` lists only `CLAUDE.md`,
  `.claude/skills/scheduling-domain/SKILL.md`,
  `web/src/app/core/collection.store.ts`,
  `web/src/app/core/collection.store.spec.ts`, and files under
  `specs/010-day-rollover-anchoring/`.

**If blocked**
If `server/` has any diff, STOP and report it — this feature is web-only by
Analyst.md's non-goals, and a `server/` change means a step went out of scope.

---

### Step 8 — Regression walk-through and wrap-up

**Model:** top-level

**Status:** done (2026-09-01, R1-R11 walked in `CriticReview.md` round 3; AD-024 + L-018 headline in `specs/STATE.md`, L-018 body in `specs/LESSONS.md` (18 headlines / 18 bodies); retrospective filled; run marker removed; root `npm run test` = 71 server + 216 web, build and `lint:ci` clean. `state_rotate.py --check` exits 1 at 326/300 lines — reported, not applied. NOT COMMITTED)

**Depends on:** Steps 1–7 — walks their combined result against `Analyst.md`.

**Files**
- MODIFY `specs/010-day-rollover-anchoring/Analyst.md` — anchor: `## Retrospective`
- MODIFY `specs/STATE.md` — anchors: `## Decisions`, `## Lessons`, `## Quick Tasks`
- MODIFY `specs/LESSONS.md`
- MODIFY `STATE.md` (repo root) — remove the `## Executing:` marker
- DO NOT TOUCH: any file under `web/`, `server/`, or `data/`.

**Do**
1. Walk R1–R11 in `Analyst.md` one at a time and record, for each, the concrete
   evidence that satisfies it (a test name, a grep result, a measured number).
   R8 is satisfied by argument plus the planning measurements, not by a test —
   say so rather than implying a test covers it.
2. Add **AD-024** to `specs/STATE.md` recording the decision: day numbers are
   local calendar days from the study day of `created`, rolling over at
   `dayCutoffHour`:00 local wall-clock; the ≤1-day reinterpretation of persisted
   values was accepted rather than migrated; `heatDateKey` was deliberately left
   alone and now diverges by up to an hour on the two DST-transition days.
3. Add **L-018** as a headline in `specs/STATE.md` **and** a body in
   `specs/LESSONS.md` — the push gate refuses a push where one exists without
   the other. Candidate headline: *"A whole test suite can pass under both the
   right and the wrong definition of a shared primitive."* (All 209 existing
   tests passed unchanged under both formulas.)
4. Fill in the `## Retrospective` section of `Analyst.md`.
5. Add a Quick Tasks row for the `## Discovered` item that `specs/STATE.md`
   lists `L-017` twice.
6. Remove the `## Executing: 010-day-rollover-anchoring` line from the repo-root
   `STATE.md`, and update its `## Current work` section.
7. Run `bash scripts/clean-table-check.sh` and report its output.

**Done when**
- `specs/STATE.md` contains `AD-024` and an `L-018` headline; `specs/LESSONS.md`
  contains an `L-018` body.
- `grep -c '^## Executing:' STATE.md` returns `0`.
- `python3 tools/state_rotate.py --check` was run and its output reported
  verbatim. **`specs/STATE.md` is at 294 lines before this step against a ~300
  line budget**, so adding AD-024, the L-018 headline and a Quick Tasks row is
  expected to push it over and make gate 4 refuse a push. Report that to the
  user as a decision they own — **do not run `--apply`** (`CLAUDE.md`: rotation
  is run by a human who has decided to rotate; no hook ever runs it for you).
- `npm run test` green from the repo root one final time.

**Do not commit — ask the user first.**
