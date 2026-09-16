# CRITIQUE: 010-day-rollover-anchoring

Summarized for the archive (2026-09-02). Three rounds ran: two harden rounds
(spec, plan) plus the post-code acceptance walk a Large feature requires. What
follows is each round's verdict, the findings that **changed something**, and
the measurements worth keeping. The round-by-round verification checklists and
the superseded 2026-08-15 review of the original `SPEC.md` are dropped — the
full text is in git history at `acc346f`.

## Measurements that outlived the rounds

Re-derived against the real host timezone (`America/Toronto`) and the live
`data/spanish/`, 2026-09-01:

- `collection.created` = 1782310835661 = 2026-06-24 **10:20:35** local,
  `dayCutoffHour` = 4 → the old effective rollover was **14:20:35 local**, not
  04:00. Old day 68 spanned 2026-08-31 14:20:35 → 2026-09-01 14:20:35.
- Live store: 7276 cards (6587 `new`, 611 `review`, **78 `schedBuried`**);
  review cards with `due <= 68` = 86, `due <= 69` = 170 → **84 surface early**.
  Deck `dec724d1698056083` held `daily {day: 68, newStudied: 20}` against
  `new.perDay = 20` — the stuck allowance, and the fix.
- **R10, minute-by-minute over all of 2026:** `todayNumber` and `heatDateKey`
  disagree on exactly **4 minutes**, all on the two DST-transition days
  (2026-03-08 and 2026-11-01). Exactly the divergence R10 predicts, no larger.
- **R5, 400 consecutive local dates at local noon:** 0 violations of "+1 per
  date", crossing both 2026 DST transitions.
- Test counts: 209 baseline → **216** after; old formula restored with the new
  tests in place fails **exactly 6 of 7**.

## Round 1 — spec. Verdict: PASS WITH NOTES

Five findings, all from *running* something rather than re-reading the prose.
Four changed `Analyst.md`:

1. **R8's transition figures hold only inside a bounded window.** Old and new
   day numbers differ by 1 only between `dayCutoffHour`:00 and `created`'s
   time-of-day (04:00:00–14:20:35); outside it they are equal. Unstated, a
   verifier opening the app at 16:00 sees none of R8's effects and concludes
   the fix did not land. → window stated in R8.
2. **R7 as written forbade what R11 requires.** The resume path
   (`computeResumeCardUpdates`) legitimately rewrites review `card.due`. →
   R7 scoped to "loading and rendering, with no user action".
3. **R8(d)'s "0 buried cards" was false.** The figure came from querying
   `buriedSibling`/`buriedUser` — queue names that do not exist in this model.
   `isBuried` matches `schedBuried`, of which the store holds **78**. The
   conclusion survived; the number did not. This was the one place in the
   Analyst where a stated number was simply wrong.
4. **R8(c)'s "about 3 h 50 m early" was measured from the moment of writing.**
   → restated as "at most the window width, 10 h 20 m".

Two accepted as-is: R6's line-number anchors were demoted to hints with
`grep -rn 'todayNumber' web/src` made the executable form; R5's "walk a full
year" is a test prescription inside a requirements section, kept deliberately
because the property that makes R5 non-vacuous on a UTC runner belongs to the
test *range*, not the implementation.

One finding was retired by round 2 rather than fixed: three specs derive
`created` from `Date.now()` and so are already time-of-day dependent under
both schemes. Executing Step 1 alone showed all 209 existing tests still pass,
so no re-baselining was needed.

## Round 2 — plan (`tasks.md`). Verdict: PASS AFTER FIXES

**The whole plan was executed once end-to-end during planning and then
reverted.** That is what moved the plan's four real defects earlier, and is
why nothing went wrong during coding:

1. Step 5's `Do` carried an unresolved self-correction in the prose ("Restore
   with `git checkout --` — no, that would discard Step 1"), exactly what
   `specs/TEMPLATE.md` says must never reach an executor. → rewritten as one
   decided instruction.
2. Step 5 asked for "at least 4 failing tests" and named three; the measured
   answer is **exactly 6 of 7**, and *which* seventh matters — the 400-day
   one-to-one walk stays green under the old formula too, because a fixed
   86.4M-ms grid also advances once per calendar day when sampled at local
   noon (noon is eight hours clear of the boundary, so an hour of DST drift
   never crosses it). Kept as a regression guard, with the plan saying plainly
   that it discriminates nothing about *this* change. → **L-018**.
3. Steps 3 and 6 used a bare `git diff --name-only` as an acceptance check.
   Both would also list the spec docs the orchestrating session edits
   concurrently, so both were guaranteed to fail. → scoped to path lists.
4. Step 1's `grep -c 'collection.created'` expects 1 but returns 2 — the new
   doc-comment mentions it. → replaced with two checks that discriminate.

Also decided: Step 8 must **report** that `specs/STATE.md` will breach gate 4
and stop, not rotate it. `state_rotate.py --apply` is a human's call
(`CLAUDE.md`), and a step that quietly rewrote the project's memory file to
turn a gate green would be the wrong lesson entirely. Recorded for later
readers: Steps 2–4 all touch `collection.store.spec.ts`, so by
`specs/TEMPLATE.md` rule 2 they are strictly sequential — this plan has no
parallel group.

## Round 3 — post-code acceptance walk

Final state: **216 web tests** (was 209) in 21 files, **71 server tests** in 10
files, `npm run build` clean, `npm run lint:ci` exit 0, `data/spanish/` and
`server/` byte-untouched.

Every requirement R1–R11 was walked against what landed. R1–R4 and R10 each
have a named test that is **red under the old formula**. R5 is green under both
(finding 2 above). R6 is `grep -rn 'todayNumber' web/src` showing an unchanged
consumer set. R7 is empty `git status --porcelain` under `data/spanish/` and
`server/`. R9 and R11 are structural — `pause-shift.ts` and the stats specs are
unmodified, so `dayDelta` stays a difference of two same-scheme calls by
construction.

**R8 is deliberately not covered by a test** and does not claim to be: it is a
statement about a one-time transition on a live store, satisfied by the round-1
measurements above.

Two process notes from this round, both since resolved:

- The push gates could not judge the work while nothing was committed —
  `clean-table-check.sh` runs over a committed range and was validating the
  *previous* HEAD. Checked by hand instead (18 headlines / 18 bodies).
- `specs/STATE.md` stood 26 lines over gate 4's budget. Left for the user;
  rotated 2026-09-02 (AD-019, AD-020 → `STATE-ARCHIVE.md`, 326 → 287 lines).
