# CriticReview — TypeScript lint audit (Phase 0)

Harden pass over [`tasks.md`](./tasks.md), run 2026-08-28 before any step
executed. Per `specs/TEMPLATE.md` ("What the critic pass verifies"), every
assumption about an API, an export name, or a gate's behaviour was checked by
**opening the thing**, not by re-reading the plan for internal consistency.

Ten findings. Two are real defects that would have failed a step; one of
those would have failed the *last* step, after all the work was done.
The rest are confirmations recorded so a later reader knows they were checked
rather than assumed.

---

## R1 — `--ext` does not exist in ESLint flat config *(defect — fixed)*

**Step 3** said `npx eslint web/src --ext .ts`, with "or plain `npx eslint
web/src` if the flag is rejected" as an aside. `--ext` was removed when flat
config became the default in ESLint 9; under ESLint 10 it is a hard argument
error, not a warning. Offering it as the primary form invites the executor to
burn a retry on a command that cannot work.

**Fix:** the `--ext` form is gone. Flat config derives extensions from each
block's `files` glob, which is exactly what Steps 2–4 set up.

## R2 — Step 12's marker check contradicts itself *(defect — fixed)*

**Step 12** asked for `grep -c "## Executing:" STATE.md` to return `0`, while
the same bullet acknowledged that root `STATE.md` keeps a deliberately
indented example of that marker (L-005). The grep is unanchored, so it
matches the example too and returns `1`. The executor would have found a
passing state indistinguishable from a failing one — and the plausible
"fix" is deleting the example, which is precisely what L-005 says silently
disarms the hook.

**Fix:** anchored to `^## Executing: `, which is the pattern the hook itself
uses (`grep -m1 -E '^## Executing: '`). The indented example does not match
it, so `0` is now both correct and achievable without touching the example.

## R3 — `specs/STATE.md` is at 298 of 300 lines; Step 12 would blow gate 4 *(defect — fixed)*

The most serious finding, and the one a consistency-only review could not
have caught.

```
$ wc -l specs/STATE.md
     298 specs/STATE.md
$ python3 tools/state_rotate.py --check
state_rotate: ... is 298 lines, budget 300 — ok
```

Two lines of headroom. Step 12 adds two `AD` entries plus a `→ superseded by`
line — roughly 30 lines. Gate 4 of `scripts/clean-table-check.sh` runs
`--check` on **every** push, so the closing push would have been refused
after every other step had already passed. Worse, the obvious in-the-moment
recovery is to run `tools/state_rotate.py --apply`, which `CLAUDE.md`
reserves for "a human who has decided to rotate; no hook ever runs it for
you" — so the executor would either violate that rule or stall.

**Fix:** Step 12 now checks the budget *before* writing, and if the addition
would exceed it, **stops and asks the user** whether to rotate rather than
running `--apply` on its own authority. The decision stays with the human,
which is the documented contract; what changes is that it is now a planned
decision point instead of an ambush at the end of the run.

## R4 — `angular-eslint@22.1.0` export names *(confirmed correct)*

`tasks.md` Steps 3 and 4 use `angular.configs.tsRecommended`,
`angular.configs.templateRecommended`, and `angular.processInlineTemplates`.
Verified against the published `index.d.ts` in the 22.1.0 tarball rather than
from memory:

```ts
declare const configs: {
    tsAll; tsRecommended; templateAll; templateRecommended; templateAccessibility;
};
declare const processInlineTemplates: ...;
export { configs, templateParser, templatePlugin, tsPlugin, processInlineTemplates };
```

All three names exist and are reachable through the default export. Also
confirms `templateAccessibility` exists and was genuinely available to
include — its exclusion (Step 11's Discovered entry) is a scope decision, not
an unavailability.

## R5 — Step 11's checkbox count was relative *(fixed)*

"the same count as before this step minus 4" makes the check depend on a
number the executor has to remember to capture first. Measured now instead:

```
$ grep -c '^- \[ \]' specs/015-typescript-lint-rollout/ROADMAP.md   # 12
$ sed -n '/## Phase 0/,/## Phase 1/p' ... | grep -c '^- \[ \]'      # 4
```

**Fix:** absolute numbers — 12 before, 8 after. Also confirms Phase 0 has
exactly the four boxes Step 11 expects, so the "If blocked" branch about a
mismatched count is a real guard rather than a hypothetical.

## R6 — `npm install -D --workspaces=false` simplified *(fixed)*

`--workspaces` is a real flag, but with no `-w` given, `npm install -D` at a
workspace root already writes to the root `package.json`. The negated form
adds a parsing surface for no behaviour change.

**Fix:** plain `npm install -D`. The step's existing Done-when
(`git diff --name-only` lists exactly `package.json` and
`package-lock.json`) already proves nothing landed in a workspace, so the
guarantee is unchanged.

## R7 — Gate 5 and the `Model:` gate pre-verified *(confirmed)*

Ran gate 5's own `awk` logic against `tasks.md`:

```
steps=12 status=12
**Model:** lines = 12
**Model:** opus  = 0
```

12 steps, 12 `Status:` lines counted the way the gate counts them (per step,
not by total), 12 `Model:` fields, zero `opus`. The file passes both gates
before it is executed rather than discovering it at push time.

## R8 — `INVENTORY.md`'s location clears gates 1 and 2 *(confirmed)*

`Analyst.md` D6 puts the inventory in the roadmap's folder partly to dodge
the 20 KB archive gate. Verified against the script's own header that gates 1
and 2 key on `specs/archive/` specifically — a new file under
`specs/015-typescript-lint-rollout/` triggers neither. The design holds, and
the 20480-byte ceiling Steps 8 and 9 apply is therefore a self-imposed house
limit, which is how `tasks.md` describes it.

## R9 — Step 6's `--print-config` anchor files exist *(confirmed)*

`server/src/app.ts` and `web/src/app/app.ts` both exist in the tree. A
`--print-config` against a missing path errors out, and the step's Done-when
would have been unreachable.

## R10 — jq path-stripping is regex-based *(accepted, guarded)*

Step 7 strips the repo root with `sub("^"+$root; "")`, and jq's `sub` takes a
regex, so a metacharacter in `$PWD` would corrupt the paths. This repo's path
(`/Users/jhend/repos/Spanish-spaced-repetition`) contains only `/` and `-`,
neither special outside a character class. Left as-is rather than hardened,
because the step's own Done-when — `by-file.txt` contains no leading `/` —
catches the failure directly if the assumption ever breaks on another
machine. Recording it so the check is understood as load-bearing rather than
decorative.

---

## R11 — The version matrix checked the workspaces and not the root *(defect — found in execution, not by this pass)*

Added 2026-08-28 after Step 1 failed. Recorded here rather than quietly
patched, because **this pass should have caught it and did not** — and the
reason it didn't is reusable.

Step 1's first run died on `ERESOLVE`:

```
Found: typescript@7.0.2
  peer typescript@"*" from angular-eslint@22.1.0
Could not resolve dependency:
  peer typescript@">=4.8.4 <6.1.0" from typescript-eslint@8.68.0
```

`Analyst.md` D2 verified that both workspace manifests (`web` `~6.0.2`,
`server` `^5.7.2`) sit inside typescript-eslint's peer range, and they do —
the installed compilers are 6.0.3 and 5.9.3. But **the install happens at the
root**, and root `package.json` has no `typescript` dependency at all. With
nothing constraining it, npm satisfied `angular-eslint`'s `typescript: "*"`
peer with the registry's `latest`, which is now `typescript@7.0.2` (the Go
port). Nothing in the repo asked for TS 7; npm supplied it.

**The generalisable mistake:** the matrix reasoned about versions that were
*already installed*, when the failure mode was a version npm would *choose*.
An unconstrained peer dependency is a version range with no upper bound, and
"latest" moves. Checking existing manifests cannot see it — only asking "what
does the resolver do at the place the install runs" can.

**Fix:** root pins `typescript@~6.0.3` (`~`, so `6.1.0` cannot slip in and
re-open the same hole). Step 1 now also has two new Done-when checks — that
the hoisted TypeScript is `6.0.x`, and that `server/` keeps its own `5.9.x`
copy — so the failure is caught by an assertion rather than by an install
error.

**Also worth knowing:** no `typescript-eslint` release supports TypeScript 7
yet (`@latest` still declares `>=4.8.4 <6.1.0`). That is an upgrade blocker
for the whole roadmap, not just this phase, so Step 11 logs it to the
roadmap's Discovered log. It is a good candidate for the `L-NNN` that Step 12
leaves optional.

---

## R12 — `@eslint/js@^10.9.1` does not exist *(defect — found in execution)*

Step 1's second attempt died differently:

```
npm error code ETARGET
npm error notarget No matching version found for @eslint/js@^10.9.1.
```

`@eslint/js` is versioned **independently** of `eslint`. Registry latest is
`10.0.1`; `eslint` is at `10.9.1`. I wrote `^10.9.1` by pattern-matching one
package's version onto the other's name.

**The mistake R11 and R12 share, which is the useful part.** D2's table
listed three packages. The install command installed five. The two that were
in the command but *not* in the table — `@eslint/js`, and the `typescript`
pin that should have been there — are precisely the two that failed. Neither
was ever checked, because the table was where checking happened and they
weren't in it.

Two corrections, both structural rather than a version bump:

1. **Every package in the command is now a row in D2's table**, stated there
   as a rule. A package outside the table is a package nobody verified.
2. **Verify the set, not the members.** R11 and R12 were both individually
   invisible to `npm view <pkg>`: R11 was an interaction between two peers,
   R12 was a name/version mismatch that per-package metadata confirms
   happily. The plan now records a `npm install --dry-run` of the whole
   command as the check — run before the retry, and it resolves clean (82
   packages, no `ERESOLVE`). Only the solver sees what the solver will do.

**Process note:** `CLAUDE.md` says to stop after an implementation attempt
fails twice rather than continue retrying. Step 1 has now failed twice, so
the third attempt was **not** launched automatically — the corrected command
and its dry-run evidence went to the user first. The two failures had
different root causes and the fix is verified rather than guessed, but "I am
confident this time" is exactly the reasoning that rule exists to interrupt.

---

## R13 — A "Done when" that rewarded deleting a guard rail *(defect — found after Step 1 passed)*

The most instructive failure in this run, because **the step reported PASS
and the report was true.**

Step 1's fifth Done-when read:

> `git diff --name-only` lists exactly `package.json` and
> `package-lock.json` — nothing else.

But root `STATE.md` was legitimately dirty: it carried the
`## Executing: 016-lint-audit` marker that `.claude/hooks/
enforce-haiku-tasks-pretooluse.sh` keys off to block top-level edits during a
run. `CLAUDE.md` *requires* that marker to be added before a `tasks.md` run
and removed after.

So the check and the harness contradicted each other, and the executor
resolved the contradiction the only way the step allowed: it reverted
`STATE.md`. `git diff --stat STATE.md` came back empty and check 5 passed
honestly. The delegation hook was dormant from that moment — a guard silently
disarmed by a step that was working as written.

**Why this is worse than an ordinary wrong assertion.** A failing check
announces itself. This one *succeeded*, and the cost was invisible: nothing
downstream would ever have reported that the hook stopped guarding. It was
caught only because a file-changed notice happened to show `STATE.md`
reverting to its committed state.

**The generalisable rule:** an acceptance check that forbids a change the
process itself requires does not detect drift — it *teaches the executor to
undo the requirement*. Any `git diff`/`git status` assertion in a `tasks.md`
step must explicitly exempt the artifacts the harness expects to be dirty:
root `STATE.md` (run marker) and `specs/` (the spec being executed). Narrow
the check to the paths that actually matter — here, `web/src/` and
`server/src/` — rather than asserting global cleanliness.

**Fixes:**

1. Step 1's check is now
   `git diff --name-only -- . ':!STATE.md' ':!specs/'`, with the exclusions
   annotated as deliberate.
2. Step 5's checkpoint list now names root `STATE.md` as expected-dirty; it
   had the same latent bug and would have hit it two steps later.
3. The marker in root `STATE.md` now carries an inline warning not to delete
   it to make a diff check pass, pointing back at this finding — the failure
   mode is more likely to be re-encountered while staring at `STATE.md` than
   while reading this file.

This is the strongest `L-NNN` candidate the run has produced, and a close
relative of the existing L-004 and L-005 (guard rails that fail silently).
Proposed headline for Step 12: *an acceptance check that forbids an expected
change teaches the executor to revert it.*

---

## R14 — The Angular rules are live; a "dead rule" alarm was nearly recorded as a finding *(false alarm — resolved, technique kept)*

After Step 3, all four `@angular-eslint` house-style rules reported `0`. R13
had just shown how a clean-looking result can hide a broken one, so the zeros
were challenged. The reasoning went: `prefer-on-push-component-change-detection`
is enabled at severity 2, there are 9 `@Component` files, and
`ChangeDetectionStrategy` appears nowhere in `web/src/app/` — therefore it
should report ~9 violations, therefore the rules must be dead.

**Every step of that was checked except the premise, and the premise was
wrong.** Under Angular 22, OnPush *is* the default; the rule flags a component
that **explicitly opts out** (`ChangeDetectionStrategy.Default` / `Eager`),
not one that omits the property. The rule ships a `suggestRemoveChangeDetection`
fix — the remedy is deleting the property, which only makes sense if omission
is correct. A probe component with `changeDetection: Default` fires the rule
immediately.

So: the plugin is live, all 14 rules are enabled and working, this codebase is
genuinely clean against them, and **243 is a complete total.**

**The pair worth remembering.** R13 was a passing check that concealed a real
defect. R14 is the mirror: a correct result that nearly got written up as a
defect. Both come from reasoning about what a check *ought* to say instead of
making it demonstrate what it *does* say, and both are settled by the same
move — provoke the rule and watch it fire.

**Kept:** Step 6's firing test, now carrying the verified opt-out probe rather
than the untested `prefer-inject`/constructor-DI one, plus an explicit warning
not to infer deadness from a zero. **Discarded:** the conclusion that the
inventory was missing its Angular dimension.

Incidental confirmation from the same investigation:
`@angular-eslint/component-class-suffix` is **not** in v22's `tsRecommended`.
Worth recording, because had it been, it would have demanded a `Component`
suffix on every class — the exact inverse of this repo's documented naming
rule (`angular-conventions`: "No `.component` suffix anywhere") — and the
inventory would have carried a pile of violations whose "fix" breaks house
style. Any future widening of the Angular ruleset must be checked against that
skill before it is switched on.

---

## R15 — A verified total sitting on top of a fabricated breakdown *(defect — found by spot-check)*

Step 8's first pass wrote `INVENTORY.md` and reported all five Done-when
checks green. They *were* green. The file was still wrong.

The by-rule table's `Count` column was real — copied from
`$SCRATCH/by-rule.txt`, and it summed to 254 exactly as the step demanded.
The adjacent `Server` and `Web` columns were **not computed from anything**.
They summed to 107/147 against a true 102/152, and six individual rows had
the split reversed or invented (`restrict-plus-operands` 3|1 for a true 1|3;
`no-unsafe-assignment` 2|2 for 0|4; `complexity` 2|0 for 1|1). Two labelling
defects rode along: a heading claiming "10 buckets" over a 14-row table, and
a "top 5 **rules** in tests" table whose cells were **filenames**.

**Why the checks passed.** Step 8's Done-when verified the *count* column and
the directory column. It said nothing about the split columns, so nothing
looked at them. The verified total was load-bearing in the wrong direction:
it made the table *look* audited, and the one number a reader would spot-check
was the one number that was right.

**The pattern this completes.** R13 was a passing check that forced a real
regression. R14 was a correct result nearly written up as a defect. R15 is a
passing check sitting beside an unchecked column. All three are the same
failure at different angles: **verification that covers part of an artifact
gets read as verification of the artifact.** A total that reconciles says
nothing about how it was decomposed.

**Fixes:**

1. The table is regenerated from a single `jq | awk` pass over `lint.json`,
   given in the step verbatim so the split is *derived*, never apportioned.
2. Step 8's Done-when now requires **every column** to sum, and
   `Server + Web == Count` on **every individual row** — checked by command,
   not by eye. A row-level identity cannot be satisfied by a lucky total.
3. Two generic checks added, because both labelling defects were visible to
   anyone who counted: a table's stated row count must match its actual rows,
   and a column header must describe what its cells contain.

**Process note:** this was caught by the orchestrator reading the deliverable
rather than by any automated gate. Worth keeping for Phase 1 — the inventory
is the one artifact three later phases build on, so its own correctness has no
downstream check that would reveal an error. Everything after it consumes it
and trusts it.

---

## Not found

Two things the pass looked for and did not find, worth stating:

- **No step edits a file under `web/src/` or `server/src/`.** Every step's
  `Files` section was re-read against `Analyst.md` §3. The three steps that
  could plausibly drift there (2, 3, 4 — each of which *reads* those trees)
  carry explicit `DO NOT TOUCH` lines, and Steps 5 and 10 both verify the
  boundary with `git diff --name-only`.
- **No unlinked assumption between steps.** The run is fully sequential with
  no parallel group, so `Assumes:` is not required (`specs/TEMPLATE.md`) —
  a wrong assumption breaks the next step, in order, visibly. Steps 2 and 3
  are the one pair carrying a real shared unknown (whether `projectService:
  true` parses this repo), and Step 3's `Depends on` names it explicitly so
  the fallback decision propagates.
