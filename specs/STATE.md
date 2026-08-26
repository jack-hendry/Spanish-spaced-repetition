# STATE — project memory

A spec tells you the plan. **This file tells the next session what the project
has learned.** Without it, every decision is lost the moment the chat context
is cleared.

## What goes where

| Event | What to add |
|---|---|
| Important architectural choice | `AD-NNN` entry under [Decisions](#decisions) |
| Something blocked me for a long time | `B-NNN` entry under [Blockers](#blockers) |
| "We learned that…" moment | `L-NNN` entry under [Lessons](#lessons) |
| Small task done without a spec | Row in [Quick Tasks](#quick-tasks) |

Domain gotchas that belong next to the rules they qualify go in the matching
skill's `## Lessons (auto-appended)` section instead — `.claude/skills/
{scheduling-domain,angular-conventions,python-pipeline,testing-playbook}/SKILL.md`.
`L-NNN` here is for project and process lessons, and is the only one the
pre-push gate enforces (AD-009).

## Rules for this file

1. **Append-only. Never renumber.** `AD-003` means the same thing forever, so
   other documents can cite it.
2. **To change a decision, add a new one** that says *"supersedes AD-XXX"*, and
   add `→ superseded by AD-YYY` to the old entry. Never edit the old entry's
   substance and never delete it — the reasoning that was wrong is the most
   useful part.
3. **Size budget.** When this file gets unwieldy (~300 lines), move old
   `AD` / `B` entries and closed Quick Tasks to `STATE-ARCHIVE.md`, leaving a
   one-line stub here. **Lesson headlines never move** — they are permanent and
   stay in this file. Their bodies live in `LESSONS.md`; that split is what
   keeps this file inside the budget without hiding a lesson behind a pointer.
   `python3 tools/state_rotate.py --check` is that rule, executable.
4. **Every entry is dated and says *why*, not just *what*.** A decision without
   its reasoning cannot be revisited safely.
5. Entries are written **when the thing happens**, not reconstructed later.
   Reconstruction is how the reasoning gets lost. (AD-001 … AD-008 below are an
   acknowledged exception: they were back-filled from the nine archived specs
   during the 2026-08-26 migration, so their reasoning is second-hand.)

## Archive ritual (run when a feature is finished)

A spec archived without its lessons recorded is **silent memory loss** — the
code keeps the decision, nobody keeps the reason. So, in order:

1. **Read the spec one more time** — `Analyst.md`, `tasks.md`, and especially
   `CriticReview.md`. The critic findings are where the lessons live.
2. **Add the `AD` / `L` (and any `B`) entries it produced.** `AD` and `B` go
   in this file in full; each `L` is a one-line headline here **plus** its body
   in `LESSONS.md`. Writing only one of the two fails the pre-push hook.
3. **Summarize the spec down to what matters** before it moves — the final
   `Analyst.md`, the decisions, what changed from the plan. Drafts and long
   back-and-forth come out. Any archived file over 20 KB fails the hook.
4. **Move the folder** to `specs/archive/YYYY-MM-DD-<name>/` (the date it was
   finished) and update anything that linked to the old path.
5. **Both changes go in the same commit.** Never a commit that moves the spec
   without the entries — that is the failure this ritual exists to prevent.

---

## Decisions

**AD-001 — Scheduling lives in the frontend; the server never computes it.**
(back-filled 2026-08-26, foundational — predates `specs/`) SM-2 and FSRS math,
the study queue, daily limits and burying all live in `web/src/app/core/`. The
server owns *card structure* (which cards exist for a note) and persistence,
nothing else. The review loop is one round-trip: the SPA rates a card, the
chosen `Scheduler` produces a new card state + a `RevlogEntry`, and both POST
to `/api/review` together. Consequence: scheduling behaviour is added in
`core/`, and the server changes only if the on-disk shape changes.

**AD-002 — Re-import identity is a hash of `(bookSlug, Card_ID)`.**
(back-filled 2026-08-26, `archive/2026-07-06-002-…`) Note `guid`s are derived
deterministically rather than generated, so re-running the importer over the
same source reconciles notes and cards **in place** and preserves their
scheduling state. Verified end-to-end in 002 T007: a second converter +
`npm run import` pass reused the same deck id and left 3638 cards and guids
unchanged. This is why the content pipeline can be re-run safely at any time,
and why changing the identity derivation is a data-loss-class change.

**AD-003 — `card.due` is overloaded by queue, and learning `due` is epoch
MILLISECONDS.** (back-filled 2026-08-26, `archive/…-004` Discovered → fixed in
`…-006` T011) `new` → a position index (time-independent); `learning` /
`relearning` → epoch **milliseconds** (`ctx.now + delayMin * 60_000`, compared
against `ctx.now = Date.now()`); `review` → a day number. The doc-comment in
`server/src/models/index.ts` and the `scheduling-domain` skill both said
"epoch seconds" for over a month while every scheduler and consumer used ms.
Trust the code. See **L-001**.

**AD-004 — Dispatch on `card.type`, never `card.queue`.**
(back-filled 2026-08-26, `archive/2026-07-09-006-…`) `queue` becomes
`'suspended'` on suspension, which **erases** the review/learning distinction;
`type` (`new`/`learning`/`relearning`/`review`) is unaffected. Any per-queue
rule keyed on `queue` therefore silently mistreats suspended cards — in 006's
case a suspended review card would not have been due-shifted like its
non-suspended counterpart, and would have been wrong the moment it was
un-suspended.

**AD-005 — Pause shifts `due` once on resume, and resume writes cards before
clearing `pausedAt`.** (back-filled 2026-08-26, `archive/2026-07-09-006-…`)
FSRS derives elapsed time as `ctx.today - (card.due - card.interval)`, so
shifting `due` forward by the paused duration makes elapsed-time math, interval
spacing and FSRS decay all come out right with **zero** changes to
`todayNumber()`, `ReviewContext`, or anything under `core/scheduling/` — no
"second clock". `POST /api/collection/resume` writes the card updates first and
clears `pausedAt` second, because that is the recoverable failure direction: a
crash between the two leaves `pausedAt` set with cards already shifted, and the
client retries from the same unchanged `pausedAt`. Payloads carry absolute
`due` values, not deltas, so re-applying converges. The reverse order looks
resumed with cards unshifted and leaves no signal to retry — explicitly
forbidden.

**AD-006 — Deck colours derive from a deck-name hash and are never persisted.**
(back-filled 2026-08-26, `archive/2026-07-07-003-…` Q3) `deckColor(name)` is a
djb2 hash → `hsl(hue, 65%, 55%)` in `web/src/app/core/deck-color.ts`. Adding a
`color` field to `Deck` would have been an on-disk shape change (and therefore
a server change) for a purely presentational affordance. Deterministic per name
is enough; the cost is that renaming a deck recolours it.

**AD-007 — `todayNumber` may be changed by 010, and its ≤1-day transition is
accepted, never migrated.** (2026-08-15, `specs/010-day-rollover-anchoring`)
007 explicitly deferred the root cause and declared changing `todayNumber`
a non-goal; 010 reverses that for this one feature. Day numbers exist in two
populations with different lifetimes — **derived at render time** from epoch-ms
(streaks, forecasts, heat, optimizer histories; these self-correct) and
**persisted** (`card.due` for review cards, `deck.daily.day`,
`collection.lastUnburyDay`; these do not). The correction comes solely from
moving where the boundaries fall. No step may re-base the persisted set, and no
artificial origin offset may be added to keep today's integer at 51 — that
would preserve the stale `deck.daily.day` match and leave the reported bug
unfixed.

**AD-008 — `specs/STATE.md` is the project memory; root `STATE.md` is a run
marker only.** (2026-08-26, migration) Two files named STATE.md is a real cost,
paid deliberately: the root one exists because
`.claude/hooks/enforce-haiku-tasks-pretooluse.sh` greps the **repo root** for
`## Executing: <spec-dir-name>`, and a hook that greps project memory would fire
on any incidental mention. Keeping the marker in a file with nothing else in it
is what makes the signal unambiguous. See **L-004**, **L-005**.

**AD-009 — Adopted habit_tracker's harness shape; retired the `/feature` +
`/resume` pipeline.** (2026-08-26) The old harness used `specs/NNN-slug/` with
`SPEC`/`PLAN`/`STATE`/`CRITIQUE.md`, four subagents, two slash commands and one
Stop hook, and routed models by a planner-assigned `Complexity:` rating. It is
replaced by: `Analyst.md` / `tasks.md` / `CriticReview.md` per
`specs/<feature-name>/`; a repo-wide `specs/STATE.md` + `specs/LESSONS.md` +
`specs/STATE-ARCHIVE.md`; per-step `Model:` fields (`haiku` / `sonnet` /
`top-level`, **never `opus`**); two PreToolUse hooks and one UserPromptSubmit
hook; and a `clean-table-check.sh` pre-push gate mirrored in CI. Why: the
enforcement layer is the part the old harness lacked entirely — its single Stop
hook asked for a STATE.md update and nothing checked archives, lesson
correspondence, memory size, or who was allowed to write what. The top-level
session now orchestrates directly; the `Model:` field replaces `resume.md`'s
complexity routing, and putting it *in the step* makes an absent one a visible
defect rather than a silent inherit of the session model. Cost, accepted: the
nine archived specs keep the old filenames (see Quick Tasks).

**AD-010 — A stale persisted `card.left` is clamped once, at the source, by one
shared helper — not guarded at each call site.** (2026-08-26,
`specs/012-clamp-learning-steps-nan-due`, from audit B1) `card.left` is
persisted; the steps array it indexes comes from deck options the user can edit,
so shortening that array left `card.left > steps.length` and the `good` branch
of all four `previewLearning`/`previewRelearning` functions read `steps[-1]` →
`undefined * 60_000` → `due: NaN`. The fix is `clampLeft(left, stepCount)` in
`web/src/app/core/scheduling/learning-steps.ts`, called at exactly the four
points where `curLeft` is first derived from `card.left` (`sm2.ts` ×2,
`fsrs.ts` ×2). Clamping into `[1, stepCount]` makes every downstream
`steps[...]` index valid *by construction*, so no second, downstream clamp is
added and `StudyQueueService` needs no change. **Why one shared helper rather
than four inline `Math.min`/`Math.max` expressions:** the audit found this bug
duplicated verbatim across `sm2.ts` and `fsrs.ts` — which is what you get when
one is written by copying the other. Four inline clamps would have re-created
exactly the condition that produced the bug. The *why* now lives in one doc
comment, in one place. Accepted residual risk: nothing forces a future fifth
`previewX` to call it, and the helper's unstated precondition is
`stepCount >= 1` (guaranteed today by the `steps.length ? … : [1]` guard at each
call site). See the `scheduling-domain` skill's 2026-08-26 lesson.

## Blockers

(none open)

## Lessons

- **L-001** — A doc that contradicts the code is worse than no doc; it gets copied.
- **L-002** — Running the dev server dirties the live data store; check `git status` before closing a feature.
- **L-003** — A green `vitest` run does not mean `tsc` passes.
- **L-004** — A guard-rail keyed to a fuzzy signal fails open *and* closed.
- **L-005** — An unindented example of a marker line shadows every real one below it.
- **L-006** — A test that goes red when you stash the fix is not proof that every case inside it is live.

## Quick Tasks

| Date | Task | Notes |
|---|---|---|
| 2026-08-26 | Ported the SDD harness from `habit_tracker` | Large, done without a spec — it is infrastructure, not a feature. Scope: `scripts/clean-table-check.sh`, `tools/state_rotate.py`, three `.claude/hooks/`, `.pre-commit-config.yaml`, `.github/workflows/ci.yml`, `ruff.toml`, `specs/TEMPLATE.md`, this file + `LESSONS.md` + `STATE-ARCHIVE.md`, root `STATE.md`. Specs 002–009 archived under their finish dates with the old `SPEC`/`PLAN`/`STATE`/`CRITIQUE` filenames intact; `004` and `006` STATE.md summarized to clear the 20 KB gate. 010 converted to `Analyst.md` + `CriticReview.md`. Retired `.claude/commands/{feature,resume}.md`, `.claude/agents/{spec-writer,planner,implementer,critic}.md`, `.claude/hooks/check-state-updated.sh`, `.claude/templates/STATE.md`. See AD-008, AD-009. |
| 2026-08-26 | Fixed the `Card.due` doc-comment at its origin | Small. `server/src/models/index.ts:92` still said "learning: epoch seconds" — 006 T011 fixed only the `scheduling-domain` skill's copy, and `CLAUDE.md` had inherited it too. Both corrected to epoch **milliseconds**. Comment-only, no behaviour change. Closes the last live instance of **L-001**. |
| 2026-08-26 | `AUDIT-2026-08-26-src.md` T2: turned on `strict` (`web/tsconfig.json`) + `strictTemplates` (`angularCompilerOptions`) | Small — audit already verified 0 errors under plain `tsc --strict`. `ng build` under `strictTemplates` surfaced one real NG8102 warning at `browser.html:66` (`draft()[f.name] ?? ''` — the `??` was dead code since `Record<string,string>` indexing can't type as `undefined`); removed it. `ng build` clean, 183 web + 37 server tests still pass, `git status` clean after. `server/tsconfig.json` already had `strict: true`. |
| 2026-08-26 | `AUDIT-2026-08-26-src.md` B3 + B4: `review.ts` template-by-ord lookup, keydown stealing input from type-in answers | Small each, same file. B3: `noteType.templates[card.ord]` → `.find(t => t.ord === card.ord)`, matching `templateByOrd` used elsewhere (`generate.ts`, `transform.ts`). B4: `onKey` now early-returns while typing an unrevealed type-in answer, handling only Enter (reveal) and Escape (blur, not navigate) — `-` and everything else reaches the input instead of triggering `suspend()`. Added 4 regression tests to `review.spec.ts`; verified they fail against the pre-fix code via `git stash` on `review.ts` alone (3 failed as expected), then restored the fix. 187 web tests green, `ng build` clean. |
| 2026-08-26 | `AUDIT-2026-08-26-src.md` C1: escape `"`/`<`/`>` in `mediaImage()`'s `<img src>` | Small. `server/src/import/transform.ts` — mirrors the escaping `transformMedia` (`template-renderer.ts`) already does for audio, closing the attribute-injection hole a `"` in a scraped/`.apkg` image URL opened (combined with `bypassSecurityTrustHtml` at render time — see audit C2, left as an accepted risk, not fixed). Added a regression test in `transform.test.ts` with a `"><script>` payload in the URL. 38 server tests green, `tsc` build clean. |
| 2026-08-26 | **Open:** widen `ruff` to the content pipeline | `ruff.toml` currently lints `tools/state_rotate.py` only. `scrape.py` and `tools/convert_apkg.py` carry 15 pre-existing violations (F401, E501, UP032) and would both be reformatted. Landing a lint job red from its first run teaches everyone to ignore it, so the widening is its own Small task: apply `ruff check --fix` + `ruff format`, then verify per `.claude/skills/python-pipeline` (re-run the converter and diff the output — there is no Python test suite, and `(slug, Card_ID)` identity is load-bearing, see AD-002). |
