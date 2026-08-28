# CriticReview — Phase 1 lint remediation

Harden pass over [`tasks.md`](./tasks.md), run 2026-08-28 before any
implementation step. Per `specs/TEMPLATE.md`: every step that assumes a type, a
signature or a value defined elsewhere had that file opened and the assumption
confirmed, rather than the plan merely being re-read for internal consistency.

11 findings. **R1–R4 were plan defects that would have broken a step**; R5–R8
are confirmations that removed a hedge from the plan; R9 is an environment
prerequisite the plan did not state; R10 pins the baseline every step's
*Done when* compares against. **R11 was found during execution, not in this
pass, and is the most serious**: the baseline "correction" this spec opened with
was itself wrong. R9 turned out to be its cause.

---

## R1 — `tasks.md` anchored 13 edits in one file by line number *(defect, fixed)*

**Severity: would have broken Step 10.** Steps 9, 10 and 12 list many edits in
a single file by line (`review.ts` L89, L90, L125, L132, L135, …). `TEMPLATE.md`
is explicit that line numbers go stale the moment an earlier edit lands, and
these steps edit the *same* file repeatedly — the first edit at L89 shifts every
line below it, so by the fourth edit the numbers name the wrong code.

Not caught by internal consistency: the step is perfectly coherent on the page.

**Fix applied:** each multi-edit step now instructs the executor to work
**highest line number first** (so earlier edits never shift later targets) and
to re-run `npx eslint <file>` between edits to re-derive positions, treating the
listed lines as the baseline map rather than live coordinates.

## R2 — the `no-empty-function` fix was left as an open choice, and the suggested form does not work *(defect, fixed)*

Step 10 item (6) said to add an explanatory comment to the empty arrow at
`review.ts:138` and then, vaguely, "if it still fires, replace it". Two problems:
it leaves a decision to the executor (TEMPLATE: *Do* must contain zero open
choices), and the primary suggestion is wrong —
`@typescript-eslint/no-empty-function` does **not** treat a comment as a body
(that is `no-empty`, a different rule), so it would always still fire.

The site is `el.play().catch(() => {})`, and it already carries the explanatory
comment on the two lines above it.

**Fix applied:** prescribe exactly `el.play().catch(() => undefined);` — an
expression body, so the rule does not apply — and leave the existing comment in
place.

## R3 — the `array-type` rewrite would not have compiled *(defect, fixed)*

Step 10 item (4) said "change `Array<T>` to `T[]`". The actual code at
`review.ts:132` is:

```ts
const detachers: Array<() => void> = [];
```

The naive rewrite gives `() => void[]`, which parses as a function returning
`void[]` — a different type, and a compile error at the `push` sites. The
correct form needs parentheses: `(() => void)[]`.

**Fix applied:** the step now gives the literal target text.

## R4 — the two `no-confusing-void-expression` sites were described generically *(clarity, fixed)*

Step 10 item (7) said "wrap each arrow-shorthand body in braces". Confirmed
against the file, both are inside the same `effect()` block:

- L142 `const onEnded = () => playAt(i + 1);`
- L144 `detachers.push(() => el.removeEventListener('ended', onEnded));`

**Fix applied:** both now named with their literal before/after text.

## R5 — `|| → ??` in `template-renderer.spec.ts` is safe; hedge removed *(confirmed)*

Step 6 item (1) told the executor to check whether `''` falling through mattered.
Opened both sites — L110 and L125 are the same shape:

```ts
expect((front.match(/<audio/g) || []).length).toBe(2);
```

`String.prototype.match` returns `RegExpMatchArray | null`. The left operand is
either `null` or an array, and an array is always truthy, so `||` and `??` are
behaviourally identical here. The hedge was noise.

**Fix applied:** step now states the conversion is safe and why, and drops the
"report it instead" branch.

## R6 — `Object.hasOwn` is available *(confirmed)*

Step 5 item (3) depends on `Object.hasOwn`, which is ES2022. `web/tsconfig.json`
sets `"target": "ES2022"` and does not narrow `lib`, so the default lib is
ES2022 and `Object.hasOwn` resolves. Had this been ES2021 the step would have
failed to compile.

## R7 — `options.original` is nullable, so the guard works as written *(confirmed)*

Step 7 item (5) replaces `this.original!` with a null guard. That only compiles
if the field is genuinely nullable — a `private original!: DeckOptions` definite
assignment would make the guard dead and trip
`no-unnecessary-condition` instead. Confirmed at `options.ts:75`:

```ts
private original: DeckOptions | null = null;
```

Also confirmed `buildPatch()` is private with one call site (L201), reached only
after `init()` assigns at L90 — so the prescribed `throw` is genuinely
unreachable, which is the intent.

## R8 — the `audios[i]` finding is real, and the prescribed fix is right *(confirmed)*

`review.ts:129` builds `const audios = Array.from(host.querySelectorAll('audio'))`
→ `HTMLAudioElement[]`. With `noUncheckedIndexedAccess` off, `audios[i]` types as
`HTMLAudioElement`, which is why ESLint reports the `if (!el) return;` guard on
L134 as both "always falsy" and "condition is always true". The guard is
nonetheless live at runtime (`playAt(i + 1)` can be called with `i + 1 ===
audios.length` from the `ended` handler).

Annotating `const el: HTMLAudioElement | undefined = audios[i];` makes the type
honest and both violations clear **without deleting a real guard** — which is
what a naive reading of "unnecessary condition" would have done. Step 10 states
"do not delete the guard" explicitly for this reason.

## R9 — the worktree needs `npm install` before any web step *(environment, added)*

`npm run test -w web` fails in a fresh worktree with `Could not find the
'@angular/build:unit-test' builder's node package` — a git worktree has no
`node_modules`, and while `npx eslint` and the server's vitest resolve upward to
the parent checkout's root `node_modules`, the Angular builder is resolved from
`web/node_modules`, which does not exist. Server tests pass (71); web tests
cannot run at all.

Every step from 4 onward has a *Done when* that runs the web suite, so all of
them would have failed on a false signal.

**Fix applied:** a Step 0 prerequisite added to `tasks.md`'s standing rules —
run `npm install` once in the worktree before Step 1 and confirm
`npm run test -w web` reports 209.

## R10 — baseline counts verified, not assumed *(confirmed)*

Every *Done when* in `tasks.md` compares against a number. All were measured on
this worktree at `origin/main` @ 66b1d70 rather than carried over from
`INVENTORY.md` (which, per `Analyst.md` §1a, is 5 high):

**Superseded by R11 — the first version of this table was measured before
`npm install` and was 5 low in `web/src`.** Corrected values, all re-measured
with dependencies installed:

| Quantity | Verified value |
|---|---|
| `npx eslint web/src`, before calibration | 152 (121 Phase 1 + 31 Phase 2) |
| `npx eslint server/src`, before calibration | 102 |
| Repo total, before calibration | 254 — matches `INVENTORY.md` exactly |
| `npx eslint web/src`, after calibration | 74 |
| `npx eslint server/src`, after calibration | 41 |
| Phase 1 residual after calibration + reassignment | 50, in 13 files |
| Server tests | 71 |
| Web tests | 209 |
| Total tests | 280 |

The intermediate checkpoint targets (60 at Step 8, 24 at Step 13) are derived
from these: 74 − 9 (Batch 1) − 5 (Batch 2) = 60; 74 − 50 = 24. The calibration
arithmetic also reconciles independently: D1 removes 13, D2 removes 43, D3
removes 83 → 139; 254 − 139 = 115 = 74 + 41. ✓

## R11 — the baseline "correction" was itself wrong *(defect, found during execution)*

**Severity: highest of this pass — it reached `Analyst.md`, a lesson, and
fourteen steps' "Done when" before anything tested it.**

Phase 1 opened by re-deriving Phase 0's baseline instead of trusting it. From a
fresh `EnterWorktree` checkout `npx eslint` reported **249** where
`INVENTORY.md` said **254**, with the gap in two `*.spec.ts` files. The
inference — Phase 0 measured against a dirty checkout — was plausible, fitted
the evidence, and was written up as finding §1(a).

It was wrong. A git worktree has no `node_modules`; `npx eslint` resolves upward
to the parent checkout and *runs*, but cannot fully resolve the types behind
`vitest`'s mock helpers, so `no-unsafe-call`, `no-unsafe-member-access` and
`no-misused-promises` silently declined to fire on 5 sites. Running
`npm install` in the worktree reproduced 254 exactly, 152/102 per workspace.

Two things let it stand as long as it did. The count was **reproducible** —
every re-run gave 249 — and determinism reads as accuracy. And the session had
already noted `git status` was clean on the original checkout at session start,
then explained that away rather than treating it as disproof.

What caught it: Step 1's executor reported 74 against a predicted 69 and
stopped, exactly as its *If blocked* clause required, instead of adjusting rule
options to hit the number. A step that says "do not tune the config to match the
number, report the mismatch" is what converted a silent wrong premise into a
visible one.

**Fixes applied:** §1(a) rewritten and the claim withdrawn (kept in the
Discovered log rather than deleted); every count in `Analyst.md`, `tasks.md` and
this file re-measured with dependencies installed; Step 2's `INVENTORY.md`
rewrite changed from "correct the 254" to "confirm the 254 and warn that the
number needs `npm install` to reproduce"; L-013 rewritten from the wrong lesson
to the real one; the newly-visible violations folded into Steps 9 and 12.

---

## Parallelism

Every step runs **sequentially**. No step declares `Assumes:` because none is in
a parallel group. Two groupings looked parallelisable and were rejected:

- **Steps 5/6/7** touch different directories, but Steps 5 and 6 both edit
  `core/templating/` (rule 2: same directory is fine, same *file* is not — they
  share none, but `template-renderer.ts` and `template-renderer.spec.ts` are
  close enough that a merge would give no signal about whether the spec still
  pins the implementation). Sequential is nearly free here and the checking is
  worth more than the wall-clock.
- **Steps 10/11/12** all touch `web/src/app/features/review/` and two of them
  edit `review.ts` itself — rule 2 forbids it outright.

## What this pass could not check

An assumption nobody wrote down. The highest-risk residue is Step 11's
decomposition of `onKey`: the plan requires preserving guard *order*, and while
`review.spec.ts` pins the type-in-answer cases added on 2026-08-26, there is no
test that fails if two unrelated key branches are swapped. Step 11 mitigates by
forbidding any change to key→action mapping and requiring
`git diff review.spec.ts` to be empty, but a reordering that happens to keep all
current tests green would survive. That is the step to review by hand.
