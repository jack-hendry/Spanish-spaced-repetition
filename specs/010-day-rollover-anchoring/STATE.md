# STATE: 010-day-rollover-anchoring

## Status
- **Phase:** plan   <!-- specify | plan | implement | done -->
- **Current task:** none
- **Last updated:** 2026-08-15

## Original request
> Fix todayNumber() day-rollover anchoring: the cutoff currently offsets from collection.created rather than a fixed local wall-clock hour, so the daily boundary drifts to (creation time-of-day + dayCutoffHour) instead of always being dayCutoffHour:00 local like Anki. Observed: collection.created = 2026-06-24 10:20:35 local, dayCutoffHour = 4, so rollover actually happens at 14:20:35 local each day; user completed 20 new cards at 2026-08-14 17:55 and saw no new cards at 2026-08-15 10:30 because day 51 does not end until 2026-08-15 14:20:35. Fix todayNumber() in web/src/app/core/collection.store.ts to anchor to the local calendar day boundary at dayCutoffHour:00. Consider impact on all consumers: study-queue.service.ts, daily-limits.ts (deck.daily.day tallies), pause-shift.ts, stats.ts, heatmap.ts (heatDateKey already uses a different, calendar-based scheme - check for consistency), and existing card.due day numbers already persisted in cards.json which were computed under the old anchoring and must not be silently shifted/corrupted.

## Completed
- [x] Spec written
- [ ] Spec approved (human)
- [ ] Plan written
- [ ] Plan approved (human)
- [ ] Reviewed & verified (/code-review + /verify after last task)

## Decisions log
- 2026-08-15: /resume found phase=specify but a complete, non-empty SPEC.md on
  disk — the spec was written in an earlier session and the phase was never
  advanced. Per the /resume guard, SPEC.md was NOT regenerated; phase advanced
  to plan and "Spec written" checked off. CRITIQUE.md was never produced for
  the spec gate (the critic did not run in that earlier session).
- 2026-08-15: critic run in spec mode on the human's request, filling that gap.
  Verdict PASS WITH NOTES — 0 blockers, 6 WARN, 3 NIT. Every factual/code/live-
  data claim in SPEC.md verified true against the repo. CRITIQUE.md written.

## Discovered
- This is the deferred work from 007-heatmap-date-off-by-one, Open question 1:
  "`todayNumber`'s `created`-anchoring flaw is the true underlying cause and also
  affects streaks/`studiedToday`/scheduling day-numbers in principle, not just the
  heatmap. Fixing that more broadly is a bigger, riskier change (it could shift live
  review-card `due` day-numbers and streak history) and is explicitly deferred."
  007 fixed only the heatmap's bucketing; this feature addresses the root cause.

## Pitfalls
(empty)

## Next action
Human reviews SPEC.md + CRITIQUE.md, then /resume to run the planner (running
/resume past this gate = spec approval). Carry into the plan phase, from the
critique: pin the day-number origin as an explicit requirement (day 0 = the
study day containing `created`); reword R5 to "no `card.due` integer changes"
since `unburyForNewDay` legitimately rewrites cards.json on the transition;
decide R4's DST testability; note Open question 3's "leave it to the critic"
option is not viable (the drift pass is append-only and cannot fix
scheduling-domain SKILL.md's stale formula at lines 36-43).

## Blockers
(none)
