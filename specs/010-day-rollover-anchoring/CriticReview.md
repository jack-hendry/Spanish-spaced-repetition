# CRITIQUE: 010-day-rollover-anchoring

The 2026-08-15 review of the original spec is superseded — its nine findings
were folded into the 2026-09-01 rewrite of `Analyst.md` and its live-store
figures (day 51) are stale. This file now holds the two harden rounds this
Large feature requires.

---

## Round 1 — 2026-09-01, mode: spec

- **Verdict:** PASS WITH NOTES

### Verified true against the repo and the live store

- `todayNumber`'s formula and location (`core/collection.store.ts:28`);
  `dailyForToday` (`core/daily-limits.ts:13`).
- `collection.created` = 1782310835661 = 2026-06-24 10:20:35 local
  (`America/Toronto`), `dayCutoffHour` = 4, `lastUnburyDay` = 68; deck
  `dec724d1698056083` `daily {day: 68, newStudied: 20, reviewStudied: 50}`,
  `dec-listening` `daily {day: 62, …}`, `opts-default new.perDay = 20`.
- Old day 68 spans 2026-08-31 14:20:35 → 2026-09-01 14:20:35; at 10:30 on
  2026-09-01 the old formula returns 68 and the calendar-day scheme returns 69.
- Revlog: 3643 entries total; 117 in the last 24 h, 2026-09-01 07:15:42 →
  08:24:17, of which 65 are `type: "learn"` over 26 distinct cards.
- Cards: 7276 total (6587 `new`, 611 `review`, 78 `schedBuried`). Review cards
  with `due <= 68` = 86, `due <= 69` = 170. `isBuried`
  (`core/lifecycle.ts:10-12`) matches `schedBuried || userBuried`, so the
  buried count is **78**, not 0 — see finding 4.
- The consumer list in R6 is exact; `core/daily-limits.ts` and `core/stats.ts`
  are confirmed non-callers (`stats.ts:100` is a comment).
- `heatmap.spec.ts` mentions `todayNumber` only in a comment (line 80); the
  heatmap never calls it.
- Baseline `npm run test -w web`: 21 files, **209 tests**, all passing.
- `.claude/skills/scheduling-domain/SKILL.md:36-43` does quote the old formula
  verbatim, and its 2026-08-31 lesson (line 217) does carry the rationale the
  Analyst says goes wrong.

### Re-derived, not re-reasoned (L-016)

The proposed behaviour was executed before being accepted, over the real host
timezone:

- Origin (R3): `today(created) === 0`; 05:00 and 23:00 the same date → 0;
  03:00 that date → −1. Correct.
- R1: 2026-09-01 03:59 → 68, 04:01 → 69, 14:30 → 69. Matches the live-store
  prediction exactly.
- R2: a `created` of 22:05 the same date yields the same origin as 10:20:35.
- R4: `created` 02:00 with cutoff 4 resolves day 0 to the *previous* calendar
  date's study day.
- R5: 400 consecutive local dates at local noon → **0** violations of "+1 per
  date" (this range crosses both 2026 DST transitions on this host).
- R10: minute-by-minute over all of 2026, `todayNumber` and `heatDateKey`
  disagree on exactly **4 minutes**, all four on the two DST-transition days:
  2026-03-08 (`todayNumber` rolls 04:00 EDT, `heatDateKey` 05:00 EDT) and
  2026-11-01 (`heatDateKey` rolls 03:00 EST, `todayNumber` 04:00 EST). The
  divergence is exactly the one R10 predicts and no larger.

### Findings

1. **[MUST FIX] R8's transition figures are true only inside a bounded window,
   and the Analyst does not say so.** Old and new day numbers differ by 1 only
   between `dayCutoffHour`:00 and `created`'s local time-of-day (here
   04:00:00–14:20:35 local); outside that window they are *equal*. So every
   consequence in R8(a)–(d) fires only if the app is first loaded during that
   ~10 h 20 m window on the day the fix lands — after 14:20:35 the transition
   is a no-op and nothing is granted, surfaced early, or unburied. State the
   window; otherwise a verifier who loads the app at 16:00 will see none of
   R8's effects and conclude the fix did not land.

2. **[MUST FIX] R7's "no `card.due` integer changes" needs a scope.** The
   resume path (`computeResumeCardUpdates`) legitimately rewrites review
   `card.due` by `dayDelta`, and R11 explicitly keeps that. As written R7
   forbids what R11 requires. Scope R7 to "loading the app and rendering it,
   with no user action" — the same carve-out R7 already grants `deck.daily`
   and `lastUnburyDay`.

3. **[WARN] R6 anchors consumers by line number.** `collection.store.ts:62,255,274`
   and friends go stale the moment any step edits those files, and a step *will*
   edit `collection.store.ts`. Keep the file list, drop or demote the line
   numbers to hints; the executable form of R6 is `grep -rn 'todayNumber' web/src`.

4. **[MUST FIX] R8(d)'s "0 buried cards" is wrong.** The figure came from a
   query for `buriedSibling`/`buriedUser` — queue names that do not exist in
   this model. `isBuried` (`core/lifecycle.ts:10-12`) is
   `queue === 'schedBuried' || queue === 'userBuried'`, and the live store
   holds **78 `schedBuried`** cards. The extra `unburyForNewDay` pass therefore
   restores 78 cards to their active queues one day early and PATCHes 78 cards
   plus the collection — not "restores nothing and only PATCHes the
   checkpoint". Still bounded, still acceptable, but a materially different
   claim, and the one place in this Analyst where a stated number was false.

5. **[WARN] Three specs derive `created` from `Date.now()`**
   (`app.spec.ts:20`, `deck-list.spec.ts:14`, `review.spec.ts:163,616,636`,
   all `Date.now() - 30 * 86_400_000`). Measured now, those give old today 29
   and new today 30 — i.e. they are *already* time-of-day dependent under both
   schemes, and the change shifts them by one inside the window from finding 1.
   The Analyst's blast-radius list names these files but does not flag that
   their day number is not stable across a clock. If any of them asserts an
   absolute day number rather than "today is large enough", it will pass or
   fail depending on the hour the suite runs. Check each; do not re-baseline.

6. **[NIT] R5's "MUST walk at least a full year of consecutive dates" is a
   test prescription in a requirements section** — the same HOW-in-WHAT
   complaint the 2026-08-15 review raised as its finding 1. Accepted here
   deliberately: without it R5 is the unverifiable MUST that review's finding 2
   flagged, since the property that makes it non-vacuous on a UTC runner is a
   property of the *test range*, not of the implementation. Leave it, but do
   not let it become licence for more of the same.

7. **[NIT] "about 3 h 50 m early" in R8(c)** is measured from 10:30, the moment
   of writing, not from a fixed thing. The stable statement is "up to the full
   width of the window in finding 1 — at most 10 h 20 m, and less the later in
   the window the app is opened."

### Round 1 resolution

Findings 1, 2, 3, 4 and 7 applied to `Analyst.md`. Finding 5 carried into
`tasks.md` as an explicit per-file check rather than an Analyst edit. Finding 6
accepted as-is with the reasoning recorded above.

---

## Round 2 — 2026-09-01, mode: plan (`tasks.md`)

- **Verdict:** PASS AFTER FIXES (all findings applied before execution began)

### Verified by opening the files, not by re-reading the plan

- `Deck.daily?: DeckDaily` exists (`web/src/app/core/models/index.ts:94`), so
  Step 4's `deck({ id: 'd1', daily: {...} })` typechecks against the spec file's
  existing factory.
- `remainingLimits(decks, subtree, today, opts)` and `dailyForToday(deck, today)`
  are exported from `core/daily-limits.ts` with the signatures Step 4 uses.
- `heatDateKey(ms, dayCutoffHour)` is exported from `core/heatmap.ts`, so
  Step 3's import resolves.
- `collection.store.spec.ts` already defines `collection()`, `deck()`,
  `deckOptions()` and `card()` factories, and imports
  `{ CollectionStore } from './collection.store'` — the import line Steps 2–4
  extend is exactly as written.
- The delegation hook (`.claude/hooks/enforce-haiku-tasks-pretooluse.sh`)
  defends `server/src|web/src|tools|scripts|.claude/hooks` — **not**
  `.claude/skills/` and **not** `CLAUDE.md`. Step 6 is still `haiku` by the
  `Model:` mapping rule (nothing in its Done when requires looking at an image),
  but it would not have been blocked either way.

### Executed, not assumed (L-016)

The whole plan was run once end-to-end during planning and then reverted, so
every count in `tasks.md` is measured:

- Step 1's change alone: **209/209 existing tests still pass**, `lint:ci` clean.
  No existing spec asserts an absolute day number, so nothing needs
  re-baselining — which retires round 1's finding 5 as a non-issue.
- Steps 1–4 together: **216/216 pass** (209 + 7).
- Old formula restored with the new tests in place: **exactly 6 of 7 fail**.

### Findings

1. **[MUST FIX — applied] Step 5's `Do` contained a self-correction in the
   prose** ("Restore with `git checkout --` — no, that would discard Step 1"),
   which is precisely the kind of unresolved choice `specs/TEMPLATE.md` says must
   never reach an executor. Rewritten as a single decided instruction, with both
   `git checkout --` and `git stash` explicitly ruled out and the reason given.

2. **[MUST FIX — applied] Step 5 asked for "at least 4 failing tests" and named
   three.** The measured answer is exactly 6, and *which* 6 matters: the
   400-day one-to-one walk (R5) **stays green under the old formula too**,
   because a fixed 86.4M-ms grid also advances once per calendar day when
   sampled at local noon — noon is eight hours clear of the boundary, so an
   hour of DST drift never crosses it. That test guards the property against a
   future regression but does not discriminate between the two formulas. Left
   in deliberately, with the plan now saying so, so its greenness is not read as
   a defect (L-006 in the other direction: a green test can be honest and still
   prove nothing about *this* change).

3. **[MUST FIX — applied] Steps 3 and 6 used bare `git diff --name-only` as an
   acceptance check.** Both would list the `specs/010-day-rollover-anchoring/`
   docs the top-level session is editing concurrently, so both were guaranteed
   to fail as written. Scoped to explicit path lists.

4. **[MUST FIX — applied] Step 1's `grep -c 'collection.created'` returns 2,
   not 1** — the new doc-comment mentions `collection.created` on its own line.
   Replaced with two checks that actually discriminate: `studyDayIndex` appears
   3 times, and `now - collection.created` appears 0 times.

5. **[WARN — applied] `specs/STATE.md` is at 294 lines against gate 4's ~300
   line budget.** Step 8 adds AD-024, an L-018 headline and a Quick Tasks row,
   which will push it over and make the pre-push check refuse. Step 8 now says
   to report that and stop — `state_rotate.py --apply` is a human's decision
   (`CLAUDE.md`), and a step that silently rotated the project's memory file to
   get a gate green would be exactly the wrong lesson.

6. **[NIT — not changed] Step 5 is the 5th step, not the 4th.**
   `specs/TEMPLATE.md` asks for a checkpoint "every ~4 steps"; Steps 2–4 are
   three small, same-file test additions that share a `describe` block, and
   splitting the checkpoint earlier would mean checkpointing a half-written
   block. Accepted.

7. **[NIT] Steps 2, 3 and 4 all modify `web/src/app/core/collection.store.spec.ts`.**
   By `specs/TEMPLATE.md`'s rule 2 that makes them strictly sequential — no
   parallel group anywhere in this plan, so no step needs an `Assumes:` field.
   Recorded so a later reader does not try to parallelise them.

---

## Round 3 — 2026-09-01, mode: post-code acceptance walk

Large features get a review after coding (`CLAUDE.md` sizing rule). This walks
each requirement in `Analyst.md` against what actually landed, and names the
evidence rather than restating the requirement.

Final state: **216 web tests** (was 209) in 21 files, **71 server tests** in 10
files, `npm run build` clean, `npm run lint:ci` exit 0, `data/spanish/` and
`server/` byte-untouched.

| Req | Evidence |
|---|---|
| R1 | `rolls over at dayCutoffHour:00 local, not at created's time-of-day` — 03:59 and 04:01 differ by 1; 04:01, 14:30 and 23:59 are equal. Red under the old formula. |
| R2 | `ignores created's time-of-day` — `created` 05:00 and 23:45 on the same date give the same number. Red under the old formula. |
| R3 | `numbers the study day containing created as day 0` — 0 at `created`, at 04:00 and at 23:59; -1 at 03:00. Red under the old formula. |
| R4 | `treats a created before the cutoff hour as the previous calendar day` — `created` 02:00 puts day 0 on the previous date. Red under the old formula. |
| R5 | `advances by exactly one per local calendar date across a full year` — 400 consecutive dates, -174 to 225, every delta 1. **Green under the old formula too** — see finding 2 of round 2; it is a regression guard, not a discriminator. |
| R6 | `grep -rn 'todayNumber' web/src` shows the same consumer set as before the change; no consumer grew date logic. Signature, export and purity unchanged (`git diff` on `collection.store.ts` touches only the helper and the function body). |
| R7 | Step 7: `git status --porcelain -- data/spanish/` and `-- server/` both empty, `git diff --stat -- server/` empty. |
| R8 | **Not covered by a test, and should not claim to be** — it is a statement about a one-time transition on a live store. Satisfied by the planning measurements recorded in round 1: day 68 to 69 at 10:30; the difference window 04:00:00-14:20:35; 84 of 611 review cards; 78 `schedBuried` cards for the extra unbury pass. |
| R9 | Structural: streaks, `studiedToday`, `reviewsByDay`, `countInRange` and the FSRS optimizer histories all re-derive day numbers from raw `reviewedAt` at render time, through the same `todayNumber`. R5's one-to-one property is what makes a contiguous history stay contiguous. No new test — the existing stats specs pass `today` as a plain number and were untouched. |
| R10 | `shares heatDateKey's day boundaries on non-DST-transition days` — red under the old formula. The DST exception is quantified in round 1 (4 minutes across 2026) and documented in the `todayNumber` doc-comment and in `scheduling-domain`. `core/heatmap.ts` unmodified; both heatmap specs unmodified and green. |
| R11 | `pause-shift.ts` unmodified — `dayDelta` is still a difference of two `todayNumber` calls, so it stays same-scheme by construction. `core/pause-shift.spec.ts` and `core/pause.service.spec.ts` green, unedited. |

### Findings

1. **[NIT] The push gates cannot yet judge this work.** `scripts/clean-table-check.sh`
   runs over a committed range, and nothing is committed, so it reports "no
   changes in range, nothing to check" and validates the *previous* HEAD (17
   lessons). Checked by hand instead: `specs/STATE.md` has 18 `L-` headlines and
   `specs/LESSONS.md` has 18 bodies, so gate 3 will pass once committed. Gate 4
   will **not**: see finding 2.

2. **[MUST DECIDE — user's call] `specs/STATE.md` is 326 lines against a 300
   budget**, 26 over, after AD-024 + the L-018 headline + the Quick Tasks row.
   `tools/state_rotate.py --check` exits 1 and proposes rotating AD-019 and
   AD-020 (39 lines) into `STATE-ARCHIVE.md`. Push gate 4 will refuse until that
   happens. Deliberately not run: `CLAUDE.md` says `--apply` is run by a human
   who has decided to rotate, and a step that quietly rewrote the project's
   memory file to turn a gate green would be the wrong lesson entirely.

3. **[NOTE] The archive ritual is not done.** This spec is code-complete but
   still lives at `specs/010-day-rollover-anchoring/`. Steps 3 and 4 of the
   ritual (summarize, then `git mv` to `specs/archive/2026-09-01-010-day-rollover-anchoring/`)
   are deliberately left, because they should happen together with the commit
   the user has not yet approved. `Analyst.md` is comfortably under the 20 KB
   archive gate.
