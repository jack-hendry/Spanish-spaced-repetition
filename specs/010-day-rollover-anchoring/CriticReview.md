# CRITIQUE: 010-day-rollover-anchoring

- **Mode:** spec
- **Date:** 2026-08-15
- **Verdict:** PASS WITH NOTES

Verified true against the repo: `todayNumber` formula and line range
(`collection.store.ts:35-38`); `dailyForToday` (`daily-limits.ts:13`);
`created` = 1782310835661 = 2026-06-24 10:20:35.661 local (host TZ
America/Toronto), `dayCutoffHour` = 4, `lastUnburyDay` = 51; both decks hold
`daily {day: 51, newStudied: 20}` against `opts-default new.perDay = 20`; the
day-50/51/52 boundary arithmetic; the 51 → 52 transition and the ~10 h 20 m
figure in R6(c); `heatDateKey`/`buildHeatGrid` (`core/heatmap.ts:35,50`),
`heatTimestamps`, `reviewTimestamps`; that the heatmap never calls
`todayNumber`; that streaks/optimizer histories re-derive from `reviewedAt`
(`deck-list.ts:88,96`, `features/stats/stats.ts:94,102`, `options.ts:130`);
and that all 7 listed blast-radius spec files exist with the cited `created:`
shapes and are the only `todayNumber`-sensitive ones.

## Findings

1. **[WARN]** HOW leaking into WHAT, and it is what buys the 185 lines (budget
   ~150). The whole "Binding constraint (on the plan)" section, R4's
   "Preferred direction: define the day number as a count of local calendar
   days…", Open question 1's "Preferred: DST-exact", and Testing expectations'
   naming of exact new spec files plus construction technique
   (`new Date(y, m, d, h, …)`, no TZ mocking) are plan-level decisions stated
   as spec content. Two of the Binding constraint's three sentences also
   restate existing non-goals. Matters because it pre-empts the planner and
   makes the spec look approved-on-implementation rather than on behaviour.

2. **[WARN]** R4 is an unverifiable MUST. It requires no skipped/duplicated day
   number across a DST transition, but the non-goals exclude "TZ mocking
   infrastructure" and Testing expectations offer no R4 test. On the host
   (America/Toronto) a local-date test exercises DST; on a UTC CI host the same
   test is silently vacuous. Either scope R4 down to what a TZ-agnostic test can
   assert, or move it to Open questions.

3. **[WARN]** The day-number *origin* is never pinned by a numbered
   requirement. R1/R2/R4 constrain only boundary placement; only R6's "differs
   from the old by at most 1" bound and a prose "Preferred direction" fix the
   absolute integer. That integer is compared against every persisted
   `card.due`, so it is the one degree of freedom where a wrong choice silently
   reinterprets the whole store. It deserves an explicit requirement (day 0 =
   the study day containing `created`).

4. **[WARN]** Unstated edge case: a `created` whose time-of-day is *before*
   `dayCutoffHour` (its study day is the previous calendar day). The only
   worked example is 10:20. This is not hypothetical — the existing specs use
   `created: 0`, which is 1969-12-31 19:00 in America/Toronto but 1970-01-01
   00:00 UTC, i.e. exactly the pre-cutoff case, on a UTC runner. The spec flags
   `created: 0`'s TZ sensitivity but not this cutoff-edge aspect.

5. **[WARN]** R5's criterion is ambiguous and partly self-contradicting.
   "byte-identical" is applied to `card.due` (a field, not a file), and the very
   load that R6(d) permits *will* rewrite `cards.json` — `unburyForNewDay`
   (`collection.store.ts:267-284`) fires because today 52 > `lastUnburyDay` 51
   and restores buried cards' `queue`, plus PATCHes the collection. A test
   written literally against R5 would fail. Say "no `card.due` integer changes"
   instead.

6. **[WARN]** Open question 3 offers a non-viable option.
   `.claude/skills/scheduling-domain/SKILL.md:36-43` does document the old
   formula verbatim (verified), so it goes stale on merge — but the critic's
   end-of-feature pass is append-only into `## Lessons (auto-appended)` and
   cannot correct a skill body. "Leave it to the critic" is not a choice; the
   real options are "in this feature" or "human does it later".

7. **[NIT]** R3 lists `daily-limits.ts` and `core/stats.ts` as `todayNumber`
   consumers; neither calls it — both receive `today: number` as a parameter.
   Real callers: `collection.store.ts:69,249,270`, `study-queue.service.ts:53,74`,
   `pause-shift.ts:20`, and the five `features/` components listed.

8. **[NIT]** "The 20 `type: "learn"` revlog entries at 2026-08-14 17:55" is
   imprecise: the revlog holds 115 `learn` entries over 40 distinct cards from
   16:36 to 17:57 (20 distinct cards in the 17:50–17:59 window; "20" is the
   per-deck `newStudied`, two decks). All 115 are after the 14:20:35 boundary,
   so the root-cause conclusion is unaffected.

9. **[NIT]** The blast-radius list omits `core/heatmap.spec.ts` and
   `shared/heatmap/heatmap.spec.ts`, the only other specs that build a
   `Collection`. Both are `heatDateKey`-based and should be unaffected — saying
   so explicitly would make R8's "007's tests stay green, unmodified" checkable.
