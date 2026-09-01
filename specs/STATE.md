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
6. **The Archive ritual (below) is a safety net, not the only entry point.**
   A `CriticReview.md` finding that resolves into a real decision, or an
   `Analyst.md` "Discovered" note that rises above a scope-parked
   observation, gets its `AD`/`L`/`B` entry written here in the same session
   that produced it. Waiting for archive time is how an abandoned or
   interrupted spec's reasoning never arrives at all — see
   `specs/014-spec-continuity/Analyst.md` for the incident that motivated
   this rule.

## Archive ritual (run when a feature is finished)

A spec archived without its lessons recorded is **silent memory loss** — the
code keeps the decision, nobody keeps the reason. So, in order:

1. **Read the spec one more time** — `Analyst.md`, `tasks.md`, and especially
   `CriticReview.md`. The critic findings are where the lessons live.
2. **Confirm the `AD` / `L` (and any `B`) entries it produced are already
   here.** Per Rule 6 above, they should have been written as they
   happened, not saved up for this step — this is a safety net, not the
   first opportunity. Add anything that was missed. `AD` and `B` go in
   this file in full; each `L` is a one-line headline here **plus** its
   body in `LESSONS.md`. Writing only one of the two fails the pre-push
   hook.
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

**AD-007 — `todayNumber` may be changed by 010, and its ≤1-day transition is accepted, never migrated.** → moved to `STATE-ARCHIVE.md`

**AD-008 — `specs/STATE.md` is the project memory; root `STATE.md` is a run marker only.** → moved to `STATE-ARCHIVE.md`

**AD-009 — Adopted habit_tracker's harness shape; retired the `/feature` + `/resume` pipeline.** → moved to `STATE-ARCHIVE.md`

**AD-010 — A stale persisted `card.left` is clamped once, at the source, by one shared helper — not guarded at each call site.** → moved to `STATE-ARCHIVE.md`

**AD-016 — `tasks.md` steps carry a mandatory `** → moved to `STATE-ARCHIVE.md`
**AD-011 — Hardening is the default; `DEV_MODE=1` is the only opt-out.** → moved to `STATE-ARCHIVE.md`

**AD-012 — A hardened server with no credentials refuses to boot.** → moved to `STATE-ARCHIVE.md`

**AD-013 — `express.json` is mounted *after* auth, deliberately.** → moved to `STATE-ARCHIVE.md`

**AD-014 — `POST /api/import` is not registered when hardened, rather than gated behind a check.** → moved to `STATE-ARCHIVE.md`

**AD-015 — `GET /api/health` is anonymous, and is the only such route.** → moved to `STATE-ARCHIVE.md`

**AD-017 — A worktree is removed when its branch merges, and any pre-existing worktree is checked against its own `HEAD` before anything is committed from it.** → moved to `STATE-ARCHIVE.md`

**AD-018 — ESLint is adopted, report-only, with the full ruleset from day one; the CI gate is deferred to a directory-at-a-time rollout.** → moved to `STATE-ARCHIVE.md`

**AD-019 — A spec's durable artifact lives in the folder that outlives the
spec, not in the spec folder.** (2026-08-28, `specs/016-lint-audit` D6) The
lint inventory is written to `specs/015-typescript-lint-rollout/INVENTORY.md`
— the *roadmap's* folder — rather than to the spec that produced it. Two
reasons, and the second is the reusable one. First, Phases 1–4 consume it, so
its lifetime is the initiative's, not this spec's. Second, **the archive
ritual's 20 KB gate collides with exactly this class of artifact**: a detailed
inventory is valuable *because* it is detailed, and `scripts/clean-table-check.sh`
refuses a push adding any file over 20 KB under `specs/archive/`. Putting it in
the spec folder would have forced a summarise pass over the one file whose
value is its detail, at archive time, by someone who no longer remembers which
rows mattered. Keeping it outside the archiving folder removes the conflict
instead of trading against it. Generalises: when a spec produces something later
work depends on, ask which folder's lifetime matches the artifact's, and put it
there — the spec folder is for the spec's own reasoning.

**AD-020 — A lint ruleset is calibrated against the codebase before it is
enforced; loosening on evidence is part of adoption, not a retreat from it.**
(2026-08-28, `archive/2026-08-31-017-lint-phase1-web`, Phase 1 of
`archive/2026-08-31-015-typescript-lint-rollout`, D1–D4) Phase 0 adopted the **full** ruleset
report-only, so Phase 1's first act is calibration, not remediation: sort every
violation class into *the code is wrong* or *the rule is miscalibrated here*.
Three of 25 rules were the latter and carried 139 of 254 violations. `eqeqeq` →
`{ null: 'ignore' }` (every hit was the `x != null` idiom; the compliant fix is
a live bug — L-014). `restrict-template-expressions` → `{ allowNumber: true }`
(all 43 hits were `${aNumber}`; `strictTypeChecked` sets `allowNumber: false`,
typescript-eslint's own default is `true`). Five rules off for `*.spec.ts` only,
each whose premise fails in a test. Result: 254 → 115, no code edited, four
directories immediately gateable.

What keeps this from being score-gaming is the counter-example:
`strict-boolean-expressions` was **not** relaxed though it would have cleared 11
more free — the roadmap names it, its hits are genuine, and one
(`review.ts:135`) was a real finding. The test is whether the change makes the
rule describe this codebase's conventions more accurately, or just makes the
number smaller.

Corollary: **calibration is global, a phase's file list is not.** The same edits
drop Phase 2 31 → 5 with no scheduling file reviewed. A relaxation removes a
*report*, not a defect — but it removes the prompt to look, so Phase 2 keeps its
full list (widened to 16 files, see AD-018) and reviews files, not residual
hits; recorded in `INVENTORY.md` so the drop never reads as progress.

**AD-021 — Phase 2 (scheduling-core lint fixes) changed no ESLint rule and
added no `eslint-disable` comments; the CI gate widened from 13 paths to a
single directory.** (2026-08-31, `archive/2026-08-31-018-lint-phase2-scheduling/`, all 14
steps completed) Phase 2 was pure remediation: 24 violations across 7 files
fixed by hand, no rule or calibration modified. Of its 17 zero-violation files,
the **five** doing `card.due`/day-number arithmetic were read against
`scheduling-domain` (2 docs/dead-code findings, recorded not fixed); the other
12 were confirmed clean and gated, not audited. The CI gate
`npm run lint:ci` moved from an incremental path list in `package.json` to
`eslint web/src` — which also picks up nine files Phase 1 never gated (they were
clean from the start and never had violations to remediate). A green exit code
from the script cannot prove the gate's scope changed, only that everything it
already covered is clean; the change is asserted on script text, not behavior
(see L-015).

**AD-022 — Phase 4 closed `specs/archive/2026-08-31-015-typescript-lint-rollout/ROADMAP.md`: the
CI gate is now the full repo (`eslint .`), and `eslint.config.mjs`/
`tools/shoot.mjs` were clean the moment they got a ruleset at all.**
(2026-08-31, `archive/2026-08-31-020-lint-phase4-full-gate/`, all 5 steps completed)
`lint:ci` moved from `eslint web/src server/src` to `eslint .`. The only two
JS/TS-family files at the repo root and in `tools/` — previously excluded by
name in `eslint.config.mjs`'s own `ignores` array — got a new config block
(`js.configs.recommended` plus four hand-declared Node globals; no
type-checked preset applies since neither file is covered by any
`tsconfig.json`) and carried **zero** violations under it, so this phase was
pure CI-gate config, not remediation. 280 tests, the build, and
`format:check` unchanged throughout. Of the roadmap's four inherited open
questions, one is now a closed decision rather than deferred work:
`web/src/index.html` stays outside the gate because it is the Angular CLI's
static host shell (no bindings, no directives), not a component template —
`angular-eslint`'s `templateRecommended` ruleset, which the existing
`web/src/app/**/*.html` glob applies, has nothing in it to check there. The
other three (`noUncheckedIndexedAccess`, test-file
`no-unsafe-*`/`no-explicit-any`, `templateAccessibility`) remain
deliberately open — no new evidence surfaced in this phase to reopen any of
them.

**AD-023 — Phase 3's `no-unnecessary-condition` sites in `server/src` were
all "type is lying," never "guard is dead," and the importer refactor was
proven byte-identical over the real corpus rather than trusted on its unit
tests.** (2026-08-31, `archive/2026-08-31-019-lint-phase3-server/`, all 11
steps) `server/src` 41 → 0; repo-wide 254 → 0 across all four phases. All
four `no-unnecessary-condition` violations were fixed by narrowing types
(three `req.body` casts, one array-index chain `noUncheckedIndexedAccess`
being off types as always-present), never by deleting a guard.
`import/transform.ts`'s complexity fix (`walk` split into
`buildNote`/`buildCard`) was verified by negative-controlled differential
testing over the real 3,638-card corpus, not by its 9 unit tests alone.

## Blockers

(none open)

## Lessons

- **L-001** — A doc that contradicts the code is worse than no doc; it gets copied.
- **L-002** — Running the dev server dirties the live data store; check `git status` before closing a feature.
- **L-003** — A green `vitest` run does not mean `tsc` passes.
- **L-004** — A guard-rail keyed to a fuzzy signal fails open *and* closed.
- **L-005** — An unindented example of a marker line shadows every real one below it.
- **L-006** — A test that goes red when you stash the fix is not proof that every case inside it is live.
- **L-009** — A hand-maintained pointer decays the moment nobody is forced to touch it.
- **L-007** — Size a limit against the largest *measured* payload, not a round number that sounds safe.
- **L-008** — A hardening change can pass every status-code check and still leave the app broken on screen.
- **L-010** — A stale worktree's `git status` is indistinguishable from deliberate deletions.
- **L-011** — An acceptance check that forbids a required change teaches the executor to delete the requirement.
- **L-012** — A total that reconciles says nothing about how it was decomposed.
- **L-013** — A type-aware linter in a tree with no dependencies installed reports a smaller number, not an error.
- **L-014** — A lint rule can make the behaviour-changing edit the compliant one.
- **L-015** — A gate's exit code cannot verify a change to the gate's own scope.
- **L-016** — A harden pass must re-derive, not re-reason: an unexecuted prescription is a hypothesis.

## Quick Tasks

| Date | Task | Notes |
|---|---|---|
| 2026-08-26 | Ported the SDD harness from `habit_tracker` | Large, done without a spec — it is infrastructure, not a feature. Scope: `scripts/clean-table-check.sh`, `tools/state_rotate.py`, three `.claude/hooks/`, `.pre-commit-config.yaml`, `.github/workflows/ci.yml`, `ruff.toml`, `specs/TEMPLATE.md`, this file + `LESSONS.md` + `STATE-ARCHIVE.md`, root `STATE.md`. Specs 002–009 archived under their finish dates with the old `SPEC`/`PLAN`/`STATE`/`CRITIQUE` filenames intact; `004` and `006` STATE.md summarized to clear the 20 KB gate. 010 converted to `Analyst.md` + `CriticReview.md`. Retired `.claude/commands/{feature,resume}.md`, `.claude/agents/{spec-writer,planner,implementer,critic}.md`, `.claude/hooks/check-state-updated.sh`, `.claude/templates/STATE.md`. See AD-008, AD-009. |
| 2026-08-26 | Fixed the `Card.due` doc-comment at its origin | Small. `server/src/models/index.ts:92` still said "learning: epoch seconds" — 006 T011 fixed only the `scheduling-domain` skill's copy, and `CLAUDE.md` had inherited it too. Both corrected to epoch **milliseconds**. Comment-only, no behaviour change. Closes the last live instance of **L-001**. |
| 2026-08-28 | Wired up Prettier for real | Small. `.prettierrc` existed in `web/` but nothing ran it and it wasn't in CI — dead config. Moved it to repo root (applies to both workspaces; the `*.html` → angular-parser override only matches files that exist in `web/`), hoisted the `prettier` devDependency from `web/package.json` to root, added `format`/`format:check` scripts scoped to `web/src` and `server/src` (not `data/spanish` or `specs/` — avoids reformatting live data or archived history), and added `npm run format:check` as a step in the CI `tests` job. Ran `format --write` once to normalize the whole (previously never-formatted) codebase — 48 files, whitespace/quote-style only, verified with `npm run test` and `npm run build` before and after. ESLint was considered and deliberately skipped: both tsconfigs already run `strict: true`, so `tsc` covers most of what a linter would catch; not worth the config surface for a solo project until a specific gap shows up. **→ superseded by AD-018** (the gap that showed up is house style: `strict: true` checks no rule in `angular-conventions`). |
| 2026-08-26 | `AUDIT-2026-08-26-src.md` T2: turned on `strict` (`web/tsconfig.json`) + `strictTemplates` (`angularCompilerOptions`) | Small — audit already verified 0 errors under plain `tsc --strict`. `ng build` under `strictTemplates` surfaced one real NG8102 warning at `browser.html:66` (`draft()[f.name] ?? ''` — the `??` was dead code since `Record<string,string>` indexing can't type as `undefined`); removed it. `ng build` clean, 183 web + 37 server tests still pass, `git status` clean after. `server/tsconfig.json` already had `strict: true`. |
| 2026-08-26 | `AUDIT-2026-08-26-src.md` B3 + B4: `review.ts` template-by-ord lookup, keydown stealing input from type-in answers | Small each, same file. B3: `noteType.templates[card.ord]` → `.find(t => t.ord === card.ord)`, matching `templateByOrd` used elsewhere (`generate.ts`, `transform.ts`). B4: `onKey` now early-returns while typing an unrevealed type-in answer, handling only Enter (reveal) and Escape (blur, not navigate) — `-` and everything else reaches the input instead of triggering `suspend()`. Added 4 regression tests to `review.spec.ts`; verified they fail against the pre-fix code via `git stash` on `review.ts` alone (3 failed as expected), then restored the fix. 187 web tests green, `ng build` clean. |
| 2026-08-26 | `AUDIT-2026-08-26-src.md` C1: escape `"`/`<`/`>` in `mediaImage()`'s `<img src>` | Small. `server/src/import/transform.ts` — mirrors the escaping `transformMedia` (`template-renderer.ts`) already does for audio, closing the attribute-injection hole a `"` in a scraped/`.apkg` image URL opened (combined with `bypassSecurityTrustHtml` at render time — see audit C2, left as an accepted risk, not fixed). Added a regression test in `transform.test.ts` with a `"><script>` payload in the URL. 38 server tests green, `tsc` build clean. |
| 2026-08-26 | **Open:** widen `ruff` to the content pipeline | `ruff.toml` currently lints `tools/state_rotate.py` only. `scrape.py` and `tools/convert_apkg.py` carry 15 pre-existing violations (F401, E501, UP032) and would both be reformatted. Landing a lint job red from its first run teaches everyone to ignore it, so the widening is its own Small task: apply `ruff check --fix` + `ruff format`, then verify per `.claude/skills/python-pipeline` (re-run the converter and diff the output — there is no Python test suite, and `(slug, Card_ID)` identity is load-bearing, see AD-002). |
| 2026-08-26 | `AUDIT-2026-08-26-src.md` B2: `formatRelativeDue` branched on `card.queue`, not `card.type` | Medium (touches `card.due` unit semantics). A suspended/buried leech carries `type: 'relearning'` with `due` still in epoch ms but `queue` in `'suspended'`/`'schedBuried'`/`'userBuried'`, so the day-number branch fired on an epoch-ms value — same trap `pause-shift.ts` already documents ("Rule is selected by `card.type`, never `card.queue`"). Fixed by branching on `card.type` in `web/src/app/core/stats.ts`; added 2 regression tests to `stats.spec.ts` reproducing the suspended-leech and buried-relearning cases from the audit, verified red via `git stash` on `stats.ts` alone. 209 web tests green. |
| 2026-08-26 | `AUDIT-2026-08-26-src.md` B5: importer restarted new-card queue positions at 0 on every import | Medium. `server/src/import/transform.ts` seeded `newCardPosition` from `0` instead of one past the existing new queue, so freshly-imported cards jumped ahead of everything already waiting (`StudyQueueService.next()` sorts new cards by `due` ascending). Added a local `nextNewPosition` helper (mirrors the one in `routes/index.ts`/`migrations.ts` — kept local per the same "importer must not depend on the route module" reasoning) and seed from `existing.cards`. Added a regression test in `transform.test.ts`, verified red via `git stash` on `transform.ts` alone. 39 server tests green. |
| 2026-08-26 | `AUDIT-2026-08-26-src.md` B6: study sessions ignored `collection.defaultDeckOptionsId`, using array position 0 instead | Medium. Added `CollectionStore.defaultDeckOptions()` (`web/src/app/core/collection.store.ts`), resolving through `collection.defaultDeckOptionsId` and falling back to `deckOptions()[0]` only when that id doesn't resolve; both call sites in `study-queue.service.ts` (`start()`'s fallback, `startAll()`) now use it. Surfaced a latent gap while fixing: `start()` used `opts` without null-checking it (masked before because untyped array indexing let `DeckOptions | undefined` through as `DeckOptions`) — added the same `if (!opts) { session = null; return false; }` guard `startAll()` already had. Added 4 regression tests across `collection.store.spec.ts` and `study-queue.service.spec.ts`; the web-tests ones verified red via `git stash` (compile error, since the new method didn't exist pre-fix). 209 web tests green, `ng build` clean. |
| 2026-08-27 | Gate 5: `**Status:**` on every `tasks.md` step is now enforced | Small, infrastructure (same treatment as the harness port above — a gate is not a feature). `scripts/clean-table-check.sh` grew a fifth gate: every `### Step ` in a changed `specs/*/tasks.md` must carry a `**Status:**` line. Checked **per step** via `awk`, not by total count, so N status lines bunched into one step cannot satisfy a file with N steps. Runs on every push over only the `tasks.md` files that push touched; `specs/archive/**` is exempt (finished history — enforcing there would make every archive move a retrofit), and a stepless `T001`-format file passes. Closes the follow-up `specs/014-spec-continuity` left open (AD-016, and the Discovered note in its `Analyst.md`); `specs/TEMPLATE.md` no longer says "no hook runs this check yet". Regression matrix in `scripts/clean-table-check.test.sh` (8 cases, throwaway repo per case), wired into CI's `hooks` job; verified red against `main`'s pre-gate script — the 3 catch-the-violation cases fail there, the 5 guard cases pass in both. |
| 2026-08-27 | **Closed:** `specs/archive/2026-08-27-013-server-hardening/tasks.md` had 15 steps and 0 `**Status:**` lines | Found while building the gate above; was never blocking (archive-exempt). Root cause: `**Status:**` had been appended to the same line as `**Model:**` (`**Model:** haiku · **Status:** done (...)`), so gate 5's `awk` — which only matches a line *starting* with `**Status:**` — never saw it. Fixed by splitting each of the 15 combined lines into two, matching `specs/TEMPLATE.md`'s convention. No content change, no re-verification needed (the spec was already done). |
| 2026-08-31 | `tools/archive_spec.py` — the archive ritual's mechanical half, executable | Small, infrastructure (same treatment as gate 5 and the harness port above — tooling is not a feature). Ritual steps 3 and 4 (summarize, move) were the costliest part of archiving by hand: an `Analyst.md` over the 20 KB push cap had to be read in full and rewritten as prose. The script does the `git mv`/`git rm`, drops whole sections by heading from **only** the files actually over the cap (default: `Retrospective`, `How do we know` — a retrospective's durable half belongs in `LESSONS.md`, and the pre-run done-when list is superseded by the acceptance walk-through), stamps an "Abridged when archived" line naming what it removed, drops an over-cap `tasks.md` as working notes (`--keep-tasks` overrides), greps for files referencing the old path, and **exits 1 if any file is still over the cap** rather than pretending success — measured on the real 018 spec, pruning got 26,678 → 22,512 bytes, still over, which is the honest boundary between the script's job and a human's. Deliberately never touches `STATE.md`/`LESSONS.md`: which findings earn an `AD`/`L` is ritual step 2's judgement call, so it prints the checklist and stops (same check/apply split and no-edits-on-your-behalf rule as `state_rotate.py`). Dry run by default. 26-case matrix in `tools/archive_spec.test.sh`, wired into CI's `hooks` job; `ruff.toml`'s `include` widened to the new file. |
| 2026-08-31 | **Open:** the colon-password auth test hangs instead of failing | Found during `specs/019-lint-phase3-server` Step 3 and deliberately **not** fixed there (scope discipline — a test-quality bug, not a lint fix). In the middleware auth test, the `password containing a colon → 200` case runs its assertions inside a `listen` callback that nothing awaits, so if the status assertion throws, the enclosing `new Promise` never resolves and the test times out rather than reporting the assertion. Phase 3's `no-misused-promises` fix preserved this exactly (voided IIFE — behaviour-preserving by design). Proper fix: take `reject` from the promise executor and call it from a `catch`, so a failed assertion fails the test with its own message. Small. |
