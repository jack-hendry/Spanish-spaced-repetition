# Analyst — TypeScript lint audit (Phase 0 of the lint rollout)

Executes **Phase 0** of
[`specs/015-typescript-lint-rollout/ROADMAP.md`](../015-typescript-lint-rollout/ROADMAP.md).
Own numbered folder, following the precedent that `011`'s Phase 0 became
`specs/013-server-hardening/` rather than living inside the roadmap folder —
so this spec can archive on its own without dragging the roadmap with it.

**Size: Large.** Full spec + harden pass. The driver is the sizing table's
*"a pattern the project never used"* criterion — ESLint flat config with
type-aware linting spanning two workspaces on two different TypeScript
versions — **not** blast radius. Blast radius here is close to zero: this
phase edits no file under `web/src/` or `server/src/`, changes no runtime
behaviour, and touches neither `ci.yml` nor any git hook. Recording that
explicitly so a later reader does not mistake the Large label for
"this could break the app".

One written harden round (`CriticReview.md`) rather than the table's two:
the roadmap already did the first round's work — it is the pre-spec analysis
that fixed the goal, the non-negotiables and the phase ordering before this
folder existed. The post-coding review the Large row also calls for is
Step 9's checkpoint plus Step 12's walk of the acceptance criteria below.
Stated rather than silently dropped.

---

## 1. What problem are we solving?

This repo documents its house style in `.claude/skills/angular-conventions`
(standalone components, `inject()` fields not constructor DI, signals-only
state, no `.component` suffix, zero `.subscribe()`) and relies on general
TypeScript hygiene everywhere else. **None of it is enforced mechanically.**
Both `tsconfig`s run `strict: true`, and Prettier gates formatting in CI as
of 2026-08-28 — but `tsc` does not know what an NgModule is, and Prettier
does not care about `any`.

So today a violation is caught only if the reviewing session happens to
remember to check for it. That is exactly the failure mode the whole SDD
harness exists to remove: a rule that depends on someone remembering is a
rule that decays.

The second problem is the one that decides *this phase's* shape. Adding
lint to a codebase that has never had it produces an unknown quantity of
remediation, and remediation of unknown size is how an initiative turns into
permanent scope creep — fixed batch by batch, discovered surprise by
surprise, never finished. Phase 0's entire job is to convert that unknown
into a written number **before** any code is changed.

### Reversing a prior decision

The Quick Tasks row dated 2026-08-28 ("Wired up Prettier for real") ends:

> ESLint was considered and deliberately skipped: both tsconfigs already run
> `strict: true`, so `tsc` covers most of what a linter would catch; not
> worth the config surface for a solo project until a specific gap shows up.

This spec reverses that. The reversal is deliberate and gets an `AD` entry
rather than being done quietly — per `specs/STATE.md` Rule 2, a decision is
changed by adding a new one that says *supersedes*, never by editing the old
one. The gap that showed up is the house-style half: `strict: true` cannot
check any rule in `angular-conventions`, and that skill's rules are the ones
most likely to be violated by a model reaching for training-data Angular.

## 2. What is in scope?

1. **Add ESLint to the repo, report-only.** One flat config at the repo
   root, dependencies in root `devDependencies`, `lint` scripts in root
   `package.json`. Covers `server/src/**/*.ts`, `web/src/**/*.ts`, and
   `web/src/**/*.html`.
2. **The full target ruleset from the start**, per the roadmap — not a
   starter set that gets widened later. Report-only makes this safe: a big
   number in a report costs nothing, whereas discovering the real number two
   phases later is the scope creep this phase exists to prevent.
3. **Run it repo-wide and write down the inventory** — violation counts by
   rule and by directory, `web/` and `server/` reported separately.
4. **Attribute every violation to a phase.** Nothing left unaccounted for.
   Everything under `web/src/app/core/scheduling/`, plus
   `collection.store.ts` and `study-queue.service.ts`, is flagged **Phase 2**
   regardless of how trivial the fix looks — roadmap non-negotiable #1.
5. **Tick Phase 0's boxes in the roadmap** and link the inventory from it.

## 3. What is OUT of scope?

The most important section. Explicitly **not** in this spec:

- **Fixing a single violation.** Not one. No `--fix`, no autofixer, no
  "while I was in there". Every violation this phase finds is Phase 1, 2 or
  3 work. A step that edits a file under `web/src/` or `server/src/` has
  gone out of scope — see the `DO NOT TOUCH` lines in `tasks.md`.
- **Touching `.github/workflows/ci.yml`.** Roadmap non-negotiable #2 — no
  red CI gate, ever. A directory joins the gate when it is already clean,
  which is Phase 1/3/4's business. The comment in `ci.yml`'s `lint` job that
  currently calls an ESLint pass "a separate, undecided step" is left alone;
  it stops being true in Phase 1, not here.
- **Touching any git hook, `.pre-commit-config.yaml`, or
  `scripts/clean-table-check.sh`.** Lint is not a push gate in this phase.
- **Suppressions.** No `eslint-disable` comments anywhere, no `ignores`
  entries added to hide a violating file. Both would falsify the inventory,
  which is the one deliverable.
- **Relaxing a rule because its count comes back large.** The count is the
  finding. Deciding a rule is not worth enforcing is a real decision, made
  in Phase 1/3 with the number in hand — not made here by quietly deleting
  the rule that produced it.
- **Phases 1–4.** Batch remediation, incremental CI gating, the
  scheduling-core spec, and the final full gate all stay in the roadmap.

## 4. Design decisions

Resolved here so `tasks.md` contains zero open choices.

**D1 — One flat config at the repo root, not one per workspace.** Follows
the Prettier precedent set 2026-08-28: root config, root devDependency, root
scripts scoped by glob. npm workspaces hoist to a single `node_modules`, so
per-workspace configs would duplicate plugin wiring for no isolation
benefit, and a reader looking for "what lints this repo" gets one file
instead of two. File: `eslint.config.mjs` (ESM — root `package.json` has no
`"type": "module"`, so the `.mjs` extension is doing real work; `.js` there
would be parsed as CommonJS and fail on its `import` statements).

**D2 — Versions, and why they are compatible.** Verified against the
registry 2026-08-28:

**Every package in the install command appears in this table.** That is a
rule, not a formatting habit — see R12: the first version of this table
listed three packages while the command installed five, and *both* omitted
packages are what failed.

| Package | Version | Why it works here |
|---|---|---|
| `eslint` | `^10.9.1` | Registry latest. Accepted by both plugins' peer ranges. |
| `@eslint/js` | `^10.0.1` | **Versioned independently of `eslint`** — latest is `10.0.1`, not `10.9.1`. Also not a transitive dependency of `eslint@10`, so the explicit entry is required, not decorative. |
| `typescript-eslint` | `^8.68.0` | Registry latest. Peer `typescript: >=4.8.4 <6.1.0`. |
| `angular-eslint` | `^22.1.0` | Registry latest. Peers: `@angular/cli >=22 <23` (matches), `typescript-eslint ^8` (matches), `eslint ^9 \|\| ^10` (matches). |
| `typescript` | `~6.0.3` | Constrains `angular-eslint`'s unbounded `typescript: "*"` peer, which npm otherwise resolves to `7.0.2`. See the note below. |

Verified by resolving the whole set together with `npm install --dry-run`
before the step ran again — 82 packages, no `ERESOLVE`. Resolving each
package's metadata individually (checking each workspace's tsconfig against
typescript-eslint's peer range) is what produced two false clears — it never
asked what npm resolves *at the root*, where the install actually happens.
Root `package.json` had no `typescript` dependency at all, so
`angular-eslint`'s unbounded `typescript: "*"` peer let npm pick the
registry's latest, `7.0.2` — which violates typescript-eslint's `<6.1.0` and
produced `ERESOLVE`. The installed compilers were never the problem; the
absence of a root constraint was.

**The set was reconsidered after this and deliberately kept whole**
(2026-08-28, user decision) rather than shrunk. Two alternatives were
rejected: dropping `@eslint/js` (ESLint 10 no longer bundles it, so
`js.configs.recommended` needs it explicitly — losing it costs
`no-debugger`, `no-constant-condition`, `no-fallthrough`, none of which
`tsc` replicates); deferring `angular-eslint` to a later phase (mechanically
viable, but it's where `prefer-standalone`/`prefer-inject` live, and §1's
whole justification for reversing "ESLint deliberately skipped" is the
house-style gap those rules close). **The lesson for later readers: the
dependency set was never the defect — the verification method was.**
Shrinking the set would have treated a process failure as a design failure.

So the root gets an explicit `typescript@~6.0.3` devDependency, resolved by
the committed `package-lock.json` (same reasoning as `ruff==0.16.4` in
`ci.yml`: a new release can't turn a green build red by surprise). Three
things about that choice:

- **`~`, not `^`.** `^6.0.3` permits `6.1.0`, which is outside
  typescript-eslint's `<6.1.0` — the same class of open range that caused
  this. `~6.0.3` allows only `6.0.x`.
- **6.0.3 specifically**, because it is what `web/` already resolves to
  (`~6.0.2` → 6.0.3). Type-aware lint rules should see the same compiler
  semantics as the code being linted.
- **`server/` is unaffected.** Its `^5.7.2` → 5.9.3 keeps its own copy under
  `server/node_modules/`, so its `tsc` build is unchanged. Verified as part
  of Step 5's checkpoint rather than assumed.

TypeScript 7.0.2 (the Go port) is the current `latest` and **no**
typescript-eslint release supports it yet — `@latest` still declares
`>=4.8.4 <6.1.0`. That is a live upgrade blocker for the whole initiative,
not a quirk of this phase, so it is logged to the roadmap's Discovered log in
Step 11.

**D3 — The ruleset.** `js/recommended` + typescript-eslint's
`strictTypeChecked` + `stylisticTypeChecked` + angular-eslint's TS and
template recommended sets, plus explicit opt-ins for the rules the roadmap
names by hand:

- `@typescript-eslint/strict-boolean-expressions` — belongs to no preset,
  opt-in only.
- `complexity` — core ESLint, off by default. Cap of 15.
- The `angular-eslint` house-style rules: `prefer-standalone`,
  `prefer-inject`, `no-empty-lifecycle-method`, `use-lifecycle-interface`.

Rules named by the roadmap that need no opt-in because a preset already
carries them (`no-explicit-any`, `no-unused-vars`) are **still written
explicitly** in the config. Redundant is fine; silently absent because a
preset's membership changed between minor versions is not, and Step 6
prints the resolved rule list so the redundancy is verifiable rather than
assumed.

*Rejected:* `eslint-plugin-sonarjs` for cognitive-complexity. The roadmap
allows this ("...or whatever `typescript-eslint`'s `recommended-type-checked`
gives for free"), and core `complexity` covers the same ground at a third of
the dependency surface. Logged in the roadmap's Discovered log as a Phase 4
option rather than dropped.

*Rejected:* `eslint-config-prettier`. typescript-eslint moved every
formatting rule out of its presets in v6, and neither `js/recommended` nor
the angular-eslint sets contain layout rules, so there is nothing for it to
turn off. Step 9 re-runs `npm run format:check` to confirm rather than
assume.

**D4 — Type-aware linting via `projectService: true`.** The alternative,
an explicit `project: [...]` array, would have to name four tsconfigs
(`server/tsconfig.json`, `web/tsconfig.{app,spec}.json`, and the
solution-style `web/tsconfig.json` with its `"files": []`) and go stale the
moment one is added. The project service resolves the right tsconfig per
file. **This is the single largest execution risk in the spec** — the
solution-style root config in `web/` is exactly the shape that trips it — so
Steps 2 and 3 carry an explicit fallback to the `project:` array form in
their **Do**, not merely an "If blocked".

**D5 — Test files are inventoried, and tagged separately.** `*.spec.ts` and
`*.test.ts` are 34 of the repo's 87 TypeScript files, and type-checked rules
are noisy over test doubles. Excluding them would make the inventory a
smaller number that is not the real number — defeating the phase. Including
them silently would let test noise dominate the counts and mis-size Phase 1.
So: linted, counted, and reported on their own row. **Whether to relax rules
for tests is Phase 1/3's decision**, and it is one that cannot be made
without these numbers. Not decided here.

**D6 — The inventory lives in the *roadmap's* folder**, at
`specs/015-typescript-lint-rollout/INVENTORY.md` — not in this spec folder.
Two reasons, the second load-bearing:

1. Phases 1–4 consume it. It is a roadmap artifact with a lifetime longer
   than this spec.
2. **The 20 KB archive gate.** When this folder archives, every file in it
   must be under 20 KB or `scripts/clean-table-check.sh` refuses the push. A
   per-file violation inventory can plausibly exceed that. Keeping it in the
   roadmap folder — which does not archive until the whole initiative
   finishes — removes the collision entirely, instead of forcing a summarise
   pass over the one artifact whose value is its detail.

It is still written to stay small: aggregated by rule and by directory, with
individual filenames enumerated **only** for the Phase 2 scheduling-core
set, which Phase 2 needs by name. Raw per-file JSON goes to the scratchpad
and is not committed.

## 5. How do we know it is done?

Concrete and checkable. Every one of these is a step's **Done when**.

1. `npm run lint` runs from a clean checkout after `npm ci` and produces a
   report over both workspaces. Non-zero exit is **expected and correct** at
   this stage — it is report-only.
2. `git diff --name-only` over the whole feature shows **zero** files under
   `web/src/` or `server/src/`.
3. `git diff --name-only` shows `.github/workflows/ci.yml` **unchanged**.
4. `grep -rn "eslint-disable" web/src server/src` returns nothing.
5. `npm run build` and `npm run test` are green, and `npm run format:check`
   passes — the config landing changed no behaviour.
6. `specs/015-typescript-lint-rollout/INVENTORY.md` exists, is under 20 KB,
   and contains: counts by rule and by directory, `web/` and `server/`
   separately; a separate test-file row; and a phase column with **no blank
   or "TBD" cells**.
7. The inventory's per-phase violation counts sum exactly to the total
   `npm run lint` reports. This is the "nothing left unaccounted for" bar,
   made arithmetic — an unattributed violation shows up as a mismatch
   instead of as a gap nobody noticed.
8. Every file under `web/src/app/core/scheduling/`, plus
   `collection.store.ts` and `study-queue.service.ts`, appears by name in
   the Phase 2 section if it has any violation at all.
9. Phase 0's four checkboxes in the roadmap are ticked and the roadmap links
   the inventory.
10. `specs/STATE.md` carries the `AD` entry superseding the 2026-08-28
    "ESLint deliberately skipped" position.
11. `git status` is clean of `data/spanish/` changes before the closing
    commit (L-002).

## 6. Retrospective

### Did `Analyst.md` catch anything not thought about up front?

Yes, one thing that would have cost real work: **D6**, putting the inventory in
the roadmap's folder because a detailed inventory collides with the archive
ritual's 20 KB gate. That was noticed while writing the spec, not while hitting
it, and it is now AD-019.

D4 — flagging `projectService: true` as the single largest execution risk and
pre-writing an explicit-`project` fallback into Steps 2 and 3 — was **correct to
worry about and wrong about the outcome**. It worked first time in both
workspaces; the fallback was never used. Cheap insurance, and worth writing
again in the same situation.

**What it missed is the more useful half.** Every one of the four real defects
came from somewhere the analysis had not looked:

- **D2's version matrix listed three packages while the install command
  installed five.** Both omitted packages (`@eslint/js`, and the `typescript`
  pin that should have existed) are exactly the two that failed. The matrix
  also reasoned about versions *already installed*, when the failure mode was a
  version npm would *choose* — root `package.json` constrained TypeScript
  nowhere, so `angular-eslint`'s unbounded `typescript: "*"` peer resolved to
  7.x. Fix: every package in the command is now a row in the table, and the set
  is resolved with `npm install --dry-run` rather than checked member by member.
- **D3 reasoned about which preset contains which rule** and never asked whether
  a rule would *fire*. That gap produced both R14 (a correct zero nearly
  reported as a dead rule) and the eventual firing probes in Step 6.
- Nothing in the analysis anticipated that a step's own acceptance check could
  motivate deleting a harness guard rail (R13/L-011).

### Did anything in `tasks.md` turn out to be wrong during coding?

Four things, three of them defects in the plan rather than in the execution.

1. **Step 1 failed twice on version defects** (R11 `ERESOLVE` on TypeScript 7,
   R12 `@eslint/js@^10.9.1` does not exist — that package is versioned
   independently of `eslint`). Both mine. `CLAUDE.md`'s stop-after-two rule
   fired and the third attempt was not launched until the corrected command had
   been dry-run verified and the user had confirmed the dependency set.
2. **Step 1's `git diff` check drove the executor to revert root `STATE.md`**,
   silently disarming the delegation hook — R13, now L-011. Step 5 carried the
   identical latent bug and would have hit it two steps later.
3. **Step 8's checks verified one column of a four-column table** while the
   split columns were fabricated — R15, now L-012. Caught by the orchestrator
   reading the deliverable, not by any gate. Worth carrying into Phase 1: the
   inventory is the artifact three later phases build on, and nothing
   downstream would reveal an error in it, because everything downstream
   consumes it and trusts it.
4. **Step 9 widened the attribution rule** by pulling `collection.store.spec.ts`
   into Phase 2. Kept — leaving a Phase 2 file's spec in a Phase 1 batch would
   let that batch rewrite the test pinning it — but documented in `INVENTORY.md`
   rather than absorbed, since a mechanical rule that is quietly widened stops
   being mechanical.

**Scope held.** Zero files under `web/src/` or `server/src/` were modified,
`ci.yml` was never touched, no `eslint-disable` was added, and no violation was
fixed. The one deliberate exception — Step 6's probe files, written under
`web/src/` and deleted immediately — was planned as such and verified clean
afterwards.

**Added mid-run:** Step 4b (three repo-specific rules — `.subscribe()` ban,
feature-to-feature import ban, `eqeqeq`), on the user's request, deliberately
before Step 7 froze the inventory. Two of the three report zero, which is the
point: they cost no remediation and stop a property currently held by hand
from eroding.
