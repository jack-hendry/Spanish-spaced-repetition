# STATE — archive

Overflow for `STATE.md`. When that file gets unwieldy (~300 lines), old
`AD` (decisions) and `B` (blockers) entries and closed Quick Tasks move here.
`python3 tools/state_rotate.py --apply` does the move; the pre-push hook only
ever runs `--check`.

Rules:

- **Lessons (`L-NNN`) never move here.** They are permanent and stay in
  `STATE.md`.
- Numbers are preserved exactly — moving an entry never renumbers it.
- A moved entry leaves a one-line stub in `STATE.md` pointing here, so a
  citation like "supersedes AD-004" is always resolvable.
- Superseded decisions are moved here, not deleted. The reasoning that turned
  out to be wrong is the most useful part of the record.

## Decisions

(nothing rotated yet)

**AD-007 — `todayNumber` may be changed by 010, and its ≤1-day transition is
accepted, never migrated.** (2026-08-15, `specs/archive/2026-09-02-010-day-rollover-anchoring`)
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

**AD-011 — Hardening is the default; `DEV_MODE=1` is the only opt-out.**
(2026-08-27, `specs/013-server-hardening`, D2) Supersedes the usual
`NODE_ENV === 'production'` shape, which was the spec's first proposal. Under
`NODE_ENV`, a *forgotten* environment variable yields the **insecure** state —
the exact failure this spec exists to prevent, and one that boots
"successfully" so nothing surfaces it. Inverting it means a forgotten variable
yields the secure state, and the insecure mode requires someone to have asked
for it by name. The second-order benefit is the one that actually decided it:
the hardened path is now what runs by default, so **the default is what gets
tested**. `server/src/config.ts` therefore contains no `NODE_ENV` branch at all,
and the step's "Done when" greps for exactly that (`grep -c NODE_ENV` → `0`) so
the old shape cannot creep back in later.

**AD-012 — A hardened server with no credentials refuses to boot.**
(2026-08-27, `specs/013-server-hardening`, D3) `loadConfig` throws `ConfigError`
when hardened and `AUTH_USER`/`AUTH_PASSWORD` are not both set; `index.ts`
catches it, logs `refusing to start: …` and exits 1. The two rejected
alternatives fail in the same way: serving unauthenticated *is* the breach, and
generating a random password nobody knows produces a machine that is up but
unreachable. A misconfiguration should be a **failed boot, not a silently wrong
one** — the same shape as the Phase 1 empty-volume sentinel.

**AD-013 — `express.json` is mounted *after* auth, deliberately.**
(2026-08-27, `specs/013-server-hardening`, §2.3) Order in `server/src/app.ts` is
`trust proxy → forceHttps → helmet → rate limit → basicAuth → express.json →
routes`. With the body parser after auth, an unauthenticated request never has
its body parsed at all, which is what demotes the body-size limit from a
security control to a tuning decision. That ordering is the substantive content
of the file and prose alone would not survive a refactor, so the step pins it
with a `grep -n` that must print `basicAuth` < `express.json` <
`app.use('/api'` in strictly increasing line order. Two more things there look
like bugs and are not: `trust proxy` is `1`, not `true` (express-rate-limit
rejects a permissive setting with `ERR_ERL_PERMISSIVE_TRUST_PROXY`, since it
would let a client spoof its IP and defeat the limiter), and the HTTPS redirect
exempts loopback — without which every local verification command gets a 308.

**AD-014 — `POST /api/import` is not registered when hardened, rather than
gated behind a check.** (2026-08-27, `specs/013-server-hardening`, §2.6)
`buildRouter(store, { allowImport })` defaults to `false` and registers the route
only when explicitly opted in; `createApp` passes
`allowImport: !config.hardened`. The route calls `runImport` →
`store.replaceAll(...)`, a whole-store rewrite with no undo, and there is no
legitimate reason to run it against a deployed instance — imports happen on the
desktop, against the desktop's data dir. A route that does not exist cannot be
reached by a mistake, a bug, or a leaked credential, and its 404 is
indistinguishable from any other unknown path, so it does not advertise that a
gated admin route exists.

**AD-015 — `GET /api/health` is anonymous, and is the only such route.**
(2026-08-27, `specs/013-server-hardening`, §2.2) Registered before every piece of
hardening middleware. Fly's HTTP health checks cannot present credentials, and a
check that 401s marks the machine unhealthy forever. It returns exactly
`{ ok: true }` and must never be extended to report store contents, counts,
versions or paths — it leaks liveness and nothing else. This is the one
deliberate hole in "auth in front of everything", recorded as such rather than
buried. Worth revisiting at Phase 1 whether a Fly **TCP** check would close it.

**AD-016 — `tasks.md` steps carry a mandatory `**Status:**` field, and durable
findings are promoted into `STATE.md` as they happen, not saved for archive
time.** (2026-08-27, `specs/014-spec-continuity`) Motivated by resuming
`specs/013-server-hardening` mid-run: with no per-step marker, resuming after
a session runs out of budget meant re-deriving progress from scratch —
grepping the codebase for what each step should have created, one step at a
time (~10 tool calls before any real work could resume). `specs/TEMPLATE.md`
now documents `**Status:** not started | in progress | done (<date>,
<evidence>)`, mandatory like `Model:`, with the same shape of grep-based gate
documented (not yet hooked up — a follow-up). A resuming session trusts the
marker to find *where* to resume, then re-verifies only that one boundary
step's Done-when — the checkpoint pattern at single-step grain instead of
every-4-steps. Paired with Rule 6 (above, in "Rules for this file"): the
Archive ritual's step 2 changed from "add the `AD`/`L` entries" to "confirm
they're already here," because `specs/013-server-hardening/CriticReview.md`
already held real, verified decisions that would have been invisible to any
future session had that spec been abandoned before archiving — see
`specs/014-spec-continuity/Analyst.md` §1 for the concrete incident. Archived
2026-08-27 to `specs/archive/2026-08-27-014-spec-continuity/` — this entry
and `L-009` below were already recorded before the archive move, confirming
Rule 6 rather than adding anything new at archive time.

**AD-017 — A worktree is removed when its branch merges, and any pre-existing
worktree is checked against its own `HEAD` before anything is committed from
it.** (2026-08-27, discovered while resuming `specs/014-spec-continuity`)
`worktree-spec-memory-tracking` was merged into `feature/SSD-habit-tracker-algined`
(PR #5) and on into `main` (PR #6), but the worktree was kept. Its branch ref
moved to the merge commit `9cb0e05` without the checkout being refreshed, so
the index and working tree stayed byte-identical to `228360b` — the pre-013
state. `git status` there showed a 24-file phantom revert, including staged
deletions of `server/src/app.ts`, `server/src/config.ts`,
`server/src/middleware/auth.ts` and all of
`specs/archive/2026-08-27-013-server-hardening/`. A commit from that worktree
would have landed as a clean revert of everything AD-011–AD-015 describe.
Two rules, because one does not cover the other: **(1)** when a branch merges,
`git worktree remove` it — not `rm -rf`, which leaves `.git/worktrees/<name>/`
behind and a phantom row in `git worktree list` until someone runs `prune`;
`git worktree unlock` first if it is locked — then `git branch -d` the branch
too, since removing a worktree leaves its ref behind and `-d` refuses if it
turns out not to be merged. **(2)** on entering any worktree
this session did not just create, `git diff --cached --quiet` must succeed
before anything is committed from it. The creation side needs no rule:
`worktree.baseRef` is unset, so `EnterWorktree` already branches from
`origin/main`. Note that merging is the *occasion*, not the mechanism — a
moving ref is — so rule (2) is what covers the unmerged case, and it is not
hypothetical: this same worktree branched from `30d1eea` and sat there while
`011c0c0` landed on the sibling branch, stale-based long before PR #5. See
L-010.

**AD-018 — ESLint is adopted, report-only, with the full ruleset from day one;
the CI gate is deferred to a directory-at-a-time rollout.** (2026-08-28,
`specs/016-lint-audit`, Phase 0 of `specs/015-typescript-lint-rollout`)
**Supersedes the 2026-08-28 Quick Tasks position** ("ESLint was considered and
deliberately skipped: both tsconfigs already run `strict: true`, so `tsc`
covers most of what a linter would catch"). That reasoning holds for the
*general TypeScript* half and is why this is not urgent — it does not hold for
the house-style half, which is the gap that reopened the question: `strict:
true` cannot check a single rule in `.claude/skills/angular-conventions`, and
those are the rules a model reaching for training-data Angular is most likely
to break. One root flat config (`eslint.config.mjs`), dependencies and scripts
at the root, following the Prettier precedent set the same day. Not wired into
`ci.yml`: a directory joins the gate once it is already clean, never before —
the same `include`-list discipline `ruff.toml` uses, for the same reason, that
a job red from its first run teaches everyone to ignore it. Baseline: **254
violations across 51 files**, attributed to Phase 1 (121), Phase 2 (31) and
Phase 3 (102), summing exactly. Notably **140 of the 254 are in test files**,
so whether to relax type-checked rules for `*.spec.ts`/`*.test.ts` is a real
decision Phases 1 and 3 now get to make with a number in hand rather than by
default. Two upgrade constraints fell out and are recorded in the roadmap's
Discovered log: the root must pin `typescript` (an unconstrained
`typescript: "*"` peer from `angular-eslint` otherwise resolves to 7.x), and no
`typescript-eslint` release supports TypeScript 7 yet.

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

## Blockers

(nothing rotated yet)

## Quick Tasks

(nothing rotated yet)
