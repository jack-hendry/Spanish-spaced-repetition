# Analyst — Phase 3: `server/src` lint remediation

Phase 3 of [`specs/015-typescript-lint-rollout/ROADMAP.md`](../015-typescript-lint-rollout/ROADMAP.md).
Follows Phase 1 (`specs/017-lint-phase1-web`) and Phase 2
(`specs/018-lint-phase2-scheduling`), both landed.

Sized **Large.** Not for its volume — 41 violations in 11 files is the smallest
phase yet — but because two of those files own scheduling state that CLAUDE.md's
sizing rule puts at "at least Large regardless of how few files it looks like":

- `routes/index.ts` — `/collection/resume` writes `card.due` for every card in
  the payload; `/review` persists the card the SPA just scheduled.
- `import/transform.ts` — the `walk` closure mints a new card's `due` position
  and its SM-2/FSRS defaults (`ease: 2500`, `interval: 0`, `stability: null`,
  `difficulty: null`), and preserves a re-imported card's prior scheduling
  state.

Both carry violations whose "obvious" fix is behaviour-changing. That is the
whole content of this phase; the other nine files are routine.

## 1. What problem are we solving?

`server/src` is the last unclean directory in the repo. Phase 0 attributed 102
baseline violations across 16 files to Phase 3; Phase 1's global calibration
(`eqeqeq`, `restrict-template-expressions`, five test-scoped rules) took that to
**41 across 11 files** without touching a line of server code. Phase 2 left it
untouched at 41, as its acceptance criteria required.

Phase 3 clears those 41 and puts `server/src` behind the CI gate, after which
Phase 4 has only the repo-root and `tools/` surface left to fold in.

## 2. What is in scope?

1. Fix all 41 violations (per-site table in §6).
2. Gate `server/src` in `npm run lint:ci`.
3. Re-baseline `INVENTORY.md`'s Phase 3 row; tick `ROADMAP.md`'s Phase 3 boxes.

## 3. What is OUT of scope?

- **`web/src`** — Phases 1 and 2 own it and it is already at zero.
- **Rule changes of any kind.** Phase 2's D1 held this line and so does this
  phase: calibration happened once, in Phase 1, on evidence. No rule is
  relaxed, no rule is added, `eslint.config.mjs` is not edited.
- **`tsconfig`'s `noUncheckedIndexedAccess`.** It is *off* (verified in
  `server/tsconfig.json`: `strict: true`, flag absent), and that is the root
  cause of the four `no-unnecessary-condition` false positives in §5(c).
  Turning it on would fix them at the source and is the honest long-term
  answer — but it re-types every array index in both workspaces, which is its
  own spec, not a line item here. → recorded for Phase 4.
- **Behaviour changes.** Every edit is behaviour-preserving. Where a fix could
  not be made behaviour-preserving it would be recorded, not forced. (None
  had to be: all 41 have a behaviour-preserving fix, verified in §7.)
- **Refactoring beyond the violation**, and the adjacent defect found in §10.
- **The five files calibration already cleaned**, including
  `store/file-store.ts` — the roadmap's "extra care" file. It carries zero
  violations, so no fix touches it and the extra-care flag is discharged by
  not editing it. Stated rather than left silent.

## 4. Method: every prescription in this document was executed before it was written

Phase 1's retrospective records that two of its four "confirmed" harden
verdicts did not survive execution. Phase 2 responded by *running* its three
risky claims — apply, compile, revert — and reported that no step had to be
rewritten. This phase took that further: **all 41 fixes were applied, linted,
type-checked, formatted and tested in this worktree, then reverted.** The
result is preserved as
[`verified-remediation.patch`](./verified-remediation.patch) so `tasks.md`
prescribes diffs that have already compiled and passed, rather than
descriptions that might.

That method immediately caught a defect in this document's own first draft —
see §10, first entry. It is the single reason to keep doing it.

`verified-remediation.patch` was a **working artifact, not spec content** — 22 KB,
over the pre-push gate's 20 KB per-file archive limit, and meaningless once the
change landed. It served as the per-step cross-check during the run and was
**deleted in Step 11**, as planned.

## 5. What reading all 41 sites found

Counted fresh in this worktree after `npm install` (L-013), at `origin/main`
@ `e083561`: **41 violations, 11 files, 9 rules**, matching `INVENTORY.md`'s
published post-calibration figure exactly.

**13 of the 41 are autofixable, and all 13 are one rule**
(`no-confusing-void-expression`). No other rule has a fixer here. That
concentration is what makes D1 possible.

Four sites are not mechanical:

**(a) `routes/index.ts:74` — `for (const update of cardUpdates ?? [])`.** The
body cast types `cardUpdates` as required, so the `??` reads as dead code. It
is not: the cast is an assertion about untrusted request input, not a fact. The
fix is to make the cast honest (`cardUpdates?:`), never to delete the fallback —
this is the one endpoint that bulk-writes `card.due`, and deleting it makes a
request that omits the field throw mid-loop, after an unknown number of cards
have already been mutated in memory.

**(b) `routes/index.ts:119` — `if (revlog) await store.appendRevlog(revlog)`.**
Same shape, and it draws *two* messages (`no-unnecessary-condition` and
`strict-boolean-expressions`) from one guard. Same fix: `revlog?: RevlogEntry`.
One character resolves both.

**(c) `routes/index.ts:175` — the deck fallback chain.** This is the
`server/src` instance of the trap `INVENTORY.md` predicted after Phase 1 found
it in `template-renderer.ts`. Without `noUncheckedIndexedAccess`, TS types
`existing[0]` and `store.getDecks()[0]` as `Card`/`Deck` — never `undefined` —
so both trailing `??` fallbacks look unreachable. They are reachable:
`existing` is empty for a note's first card and `getDecks()` is empty on a
fresh store, and at runtime the index genuinely yields `undefined` in both
cases. Deleting them hands `undefined` to `reconcileNoteCards`'s `deckId`
parameter. Fix: `.at(0)`, which is typed `T | undefined` — the same instrument
Phase 1 used at `review.ts:135`.

**(d) `import/transform.ts:176` — `walk` at complexity 17 (max 15).** The only
violation in this phase that cannot be fixed by editing the flagged line. It
requires decomposing the function that assigns new-card `due` and the SM-2/FSRS
defaults — where a careless extraction could reorder `newCardPosition++`
relative to the card push, or drop a field from the preserved-vs-fresh branch,
and neither would fail a type check. §7 describes the equivalence harness built
to prove it didn't.

## 6. The 41 fixes, one by one

Grouped as `tasks.md` takes them. Every entry is behaviour-preserving on every
reachable path; (a)–(d) above are the ones that needed argument.

| # | Site(s) | Rule | Fix |
|---|---|---|---|
| 1–13 | `app.ts` ×4, `middleware/auth.ts` ×3, `auth.test.ts` ×2, `app.integration.test.ts` ×2, `notes.integration.test.ts` ×1, `resume.integration.test.ts` ×1 | `no-confusing-void-expression` | D1 — `eslint --fix`. `return f();` → `{ f(); return; }`, `() => r()` → `() => { r(); }`. Then `npm run format` (D2). |
| 14 | `app.ts:97` | `strict-boolean-expressions` | `if (config.staticDir)` → `!= null`. Typed `string \| null` and only ever an existing directory path or `null` (`config.ts:50`), so `''` is unreachable and `!= null` is exact. |
| 15 | `routes/index.ts:74` | `no-unnecessary-condition` | §5(a) — `cardUpdates?:` in the cast. The `?? []` stays. |
| 16–17 | `routes/index.ts:119` | `no-unnecessary-condition`, `strict-boolean-expressions` | §5(b) — `revlog?:` in the cast. The guard stays. |
| 18–19 | `routes/index.ts:175` | `no-unnecessary-condition` ×2 | §5(c) — `existing.at(0)`, `store.getDecks().at(0)`. |
| 20 | `routes/index.ts:93` | `strict-boolean-expressions` | `deckId ? filter : all` → `deckId != null && deckId !== ''`. **The `!== ''` is load-bearing** — unlike Phase 2's #7–8, where the empty-string case was argued away. `?deckId=` yields `''`; the truthy test sent that down the "all cards" branch, and `!= null` alone would send it to the filter, which matches no card and returns `[]`. |
| 21–26 | `transform.ts:27,124,144,146,184,255` | `no-non-null-assertion` | Three shapes. `124/144/146`: Phase 2's D2 — `has()`+`get()!` becomes one `get()` into a local; the trailing lookup disappears because the loop already holds the deck. `255`: `order` changes from `string[]` to `Deck[]`, which **removes** the cross-structure invariant rather than asserting it. `27`: a real `throw` — the key is a seed constant, so this is the one site with no structural fix, and a named error beats a downstream `undefined` dereference. `184`: narrow inline (`if (Array.isArray(node.cards) && …)`) instead of via an intermediate boolean const, which TS does not carry through. |
| 27–28 | `transform.ts:82,87` | `strict-boolean-expressions` | `!!v` → `v != null && v !== ''`. Exactly equivalent: `v` is `string \| null \| undefined` and `''` is the only falsy string. Both are type predicates and still narrow. |
| 29 | `transform.ts:208` | `restrict-plus-operands` | `'c' + guid + '-' + ord` → `` `c${guid}-${ord}` ``, per Phase 2's #12. **This line is the card-identity contract** (`python-pipeline`: card id = `c{guid}-{ord}`). The template literal is byte-identical for integer `ord`; §7's corpus diff is what proves it rather than asserts it. |
| 30 | `transform.ts:176` | `complexity` | §5(d) — extract `buildNote` and `buildCard`. `newCardPosition` is passed in and advanced by the caller **only when no prior card existed**, preserving `due: newCardPosition++`'s exact sequencing. |
| 31–33 | `index.ts:35,36,39` | `no-misused-promises` ×2, `use-unknown-in-catch-callback-variable` | The SIGINT/SIGTERM listener becomes sync and wraps its async body in `void (async () => …)()`. This is the `flushAll()` path CLAUDE.md names as the reason no review is lost on shutdown; the voided IIFE keeps it fire-and-forget exactly as `process.on` already treated it. `.catch((err: unknown) =>`. |
| 34 | `import/cli.ts:25` | `use-unknown-in-catch-callback-variable` | `.catch((err: unknown) =>`. |
| 35–37 | `app.integration.test.ts:24`, `notes.integration.test.ts:27`, `resume.integration.test.ts:28` | `no-misused-spread` | The same duplicated `api()` helper in three files. `{ 'content-type': …, ...(init?.headers ?? {}) }` → `new Headers(init?.headers)` + `if (!headers.has('content-type')) set(…)`. A real catch, not a false positive: `HeadersInit` includes `string[][]`, which object-spreads to numeric indices. Caller-supplied headers still win, as they did when spread last. |
| 38–39 | `auth.test.ts:17,81` | `strict-boolean-expressions` | `addr && typeof addr === 'object'` → `addr != null && …`. |
| 40 | `auth.test.ts:79` | `no-misused-promises` | `listen(0, async () => …)` → sync listener wrapping `void (async () => …)()`. See §10 for what this deliberately does *not* fix. |
| 41 | `store/seed.test.ts:14` | `strict-boolean-expressions` | `if (dir)` → `if (dir != null)`. |

## 7. Verified effect

All 41 applied together in this worktree, then reverted:

| Check | Result |
|---|---|
| `npx eslint server/src` | **0 violations** (from 41) |
| `npx tsc --noEmit -p server/tsconfig.json` | clean |
| `npm run format:check` | clean — **after** `npm run format`; see D2 |
| `npm test -w server` | 71 passed |
| `npm test` (root) | 71 server + 209 web = **280**, unchanged |

### The importer needed more than a green suite

`transform.test.ts`'s 9 tests are good but they do not pin the identity
contract across a whole corpus, and #29–30 touch card-id construction and
new-card `due` sequencing. So the refactor was checked by **differential
testing** instead: the pre-change `transformBooks` was kept alongside the new
one and both run over the real `data/spanish/_source/` corpus (**3,638 scraped
cards**), comparing `JSON.stringify` of the full `ImportResult` — every deck
id, note id, card id, `due`, `ease`, `interval` and FSRS field.

Three scenarios, all byte-identical:

1. **Cold import** — every card fresh, so `newCardPosition` runs from 0 across
   the whole corpus.
2. **Re-import over existing scheduling state** — every third card given real
   review state (`due`, `reps: 5`, `ease: 2300`, `interval: 12`), exercising
   the preserve branch.
3. **Re-import with gaps** — every other card dropped, so fresh cards are
   minted *interleaved* with preserved ones. This is the one that would catch
   a `newCardPosition++` that moved.

**The harness was negative-controlled.** Perturbing `ease: 2500` → `2400` in
the new transformer failed scenarios 1 and 3 (scenario 2 passed, because every
card there has a prior and never reaches the fresh-card branch — which also
confirms each scenario covers the branch it claims). A harness that cannot fail
is worse than none (L-024); this one demonstrably fails.

The harness is deliberately **not** committed: it depends on keeping a copy of
the pre-change module, which has no meaning once the change lands. It is
described here so it can be rebuilt, and `tasks.md` reproduces it as a step.

## 8. Decisions

### D1 — `eslint --fix` is used, for one rule, with the diff read

Both prior phases wrote "no unattended autofix run is planned." They had little
to gain: 9 of 50 and 5 of 24 fixable. Here it is 13 of 41 — **32%, all
`no-confusing-void-expression`**, and the transformation is
`return f();` → `{ f(); return; }`, which is syntactic.

The word doing the work in the prior phases' rule is *unattended*. The fixer's
output on all 13 sites was read as a diff before being accepted, including the
three in `middleware/auth.ts`, where the early-return structure of the
credential check is security-relevant and the rewrite preserved it exactly. So:
autofix, then read every hunk. Not autofix and trust the count.

### D2 — Autofix must be followed by `npm run format`

Measured, not assumed: the fixer emits `{ next(); return; }` on one line, which
is not prettier's style, and `npm run format:check` fails on exactly the files
`--fix` touched. Running `npm run format` afterwards resolves it, and
re-linting after formatting confirms the format pass reintroduces nothing.

This ordering is a real trap for a delegated step — `eslint` says clean,
`format:check` says dirty, and a step that only checks the former reports
success over a tree that fails CI.

### D3 — The gate becomes `web/src server/src`, two paths, not a grown list

Phase 2's D6 collapsed the web half to one directory after discovering nine
clean-but-ungated files that Phase 1's violation-sized batches had silently
skipped. The roadmap records that as "a pattern-level warning for Phase 3."

So Phase 3 does not grow a path list batch by batch. When `server/src` is
clean, the gate becomes `eslint web/src server/src` in one step. Any server
file with no violations today — `file-store.ts`, `cards/generate.ts`,
`migrations.ts`, `import/run.ts`, `models/index.ts` and every future one — is
covered by the directory, not by having been remembered.

### D4 — The `lint:ci` Done-when asserts on the script's text (L-015)

`npm run lint:ci; echo $?` prints 0 whether or not the step widened the script,
because everything already named is already clean. Phase 1 shipped exactly this
vacuous check and an executor truthfully reported `exit=0` having skipped the
edit. The step's Done-when therefore greps `package.json` for the literal path
string *and* runs the gate.

### D5 — No `eslint-disable` anywhere

Phase 0's acceptance criteria included `grep -rn "eslint-disable" web/src
server/src` returning nothing, and it still does. Every one of the 41 has a
real fix; none needs suppression. Carried forward as an acceptance criterion so
the easy exit stays closed.

## 9. How do we know it is done?

1. `npx eslint server/src` reports **zero**.
2. `grep 'lint:ci' package.json` shows both `web/src` and `server/src`, and
   `npm run lint:ci` exits 0 (D4 — both halves, the grep is the real check).
3. `npm run format:check` clean (D2).
4. `npx tsc --noEmit -p server/tsconfig.json` clean; `npm run build` succeeds.
5. `npm test` green at **280** (71 server, 209 web) — unchanged from first step
   to last.
6. `grep -rn "eslint-disable" web/src server/src` returns nothing (D5).
7. `git diff --name-only origin/main..HEAD -- web/src` returns nothing — Phase
   3 does not touch the web workspace at all.
8. The importer refactor is proven by the corpus equivalence harness of §7,
   negative control included — not by `transform.test.ts` alone.
9. The four non-mechanical sites of §5 are fixed as specified (type narrowed,
   guard kept) — confirmed by reading the diff, not by the count reaching zero.
10. `INVENTORY.md` Phase 3 row and `ROADMAP.md` Phase 3 boxes updated; Phase 4
    inherits the two items in §10.

## 10. Discovered

- (2026-08-31) **This document's own first draft prescribed a fix that cannot
  work, and it was a repeat of a recorded lesson.** For §5(c) it specified
  `const firstExisting: Card | undefined = existing[0]`. Applied, that made
  things *worse* — 2 violations became 4, because TypeScript narrows a `const`
  to its initializer's type regardless of the annotation, so the `?.` then read
  as an unnecessary optional chain too. Phase 1 hit the identical wall
  (Analyst §10: "R8 … prescribed an annotation that cannot work — TypeScript
  narrows a `const` to its initializer's type") and the repo already had the
  working instrument in `review.ts:135`: `.at(0)`. Reasoning about the fix
  reproduced a known-bad answer; running it took 40 seconds to refute. This is
  the argument for §4's method, and it is worth an `L-` headline of its own:
  *the harden pass must re-derive, not re-reason — a prescription that has not
  been executed is a hypothesis.*
- (2026-08-31) **`auth.test.ts:79`'s test hangs rather than fails.** The
  assertions inside that `listen` callback are already fire-and-forget: if
  `expect(res.status).toBe(200)` throws, the outer `new Promise` never
  resolves and the test times out instead of reporting the assertion. The
  `no-misused-promises` fix (#40) preserves this exactly, because the phase's
  rule is behaviour preservation. Fixing it properly means rejecting the outer
  promise from a `catch`. **Not done here** — it is a test-quality improvement,
  not a lint fix, and CLAUDE.md's scope discipline says write it down instead.
  → Quick Tasks.
- (2026-08-31) **`noUncheckedIndexedAccess` is off, and that is what generates
  the `??`-is-dead false positives.** Four of this phase's violations exist
  only because an out-of-bounds array index is typed as present. `.at(0)`
  fixes them one site at a time; the flag fixes the class. It re-types every
  array index in both workspaces, so it is Phase 4's call or its own spec.
- (2026-08-31) **Phase 3 inherits none of the `no-unsafe-*` test-file debt.**
  Phase 1 deferred that question to Phase 4 and Phase 2 typed its mocks;
  `server/src` has zero `no-unsafe-*` and zero `no-explicit-any` violations, so
  the deferral does not reach here. After this phase, Phase 4's remaining
  surface is the repo root, `tools/`, and `web/src/index.html` (outside the
  config's template glob — Phase 2's finding).

## 11. Acceptance criteria — walked 2026-08-31

| # | Criterion | Result |
|---|---|---|
| 1 | `npx eslint server/src` reports zero | **Pass.** Exit 0, no output (was 41). |
| 2 | `lint:ci` names both paths and exits 0 | **Pass.** `"lint:ci": "eslint web/src server/src"`, grepped as text per D4, and exit 0. |
| 3 | `npm run format:check` clean | **Pass.** |
| 4 | `tsc --noEmit` and `npm run build` clean | **Pass**, both exit 0. |
| 5 | `npm test` green at 280 | **Pass.** 71 server + 209 web, unchanged from first step to last. |
| 6 | No `eslint-disable` in either workspace | **Pass.** Grep returns nothing. |
| 7 | `web/src` untouched | **Pass.** Both `origin/main..HEAD` and working-tree diffs empty. |
| 8 | Importer proven by corpus equivalence, negative control included | **Pass.** 3/3 byte-identical over 3,638 scraped cards; perturbing `ease` failed exactly 2 of 3 (the two that reach the fresh-card branch), then 3/3 after restoring. |
| 9 | The four non-mechanical sites fixed as specified | **Pass.** Re-grepped in the file itself, not in the executor's report: `cardUpdates ?? []`, `if (revlog)` and the `.at(0)` chain all still present, both casts optional. |
| 10 | `INVENTORY.md` + `ROADMAP.md` updated, Phase 4 inheritance recorded | **Pass.** Plus five dated Discovered entries and the L-016 pair. |

Repo-wide: **254 → 0** across all four phases.

## 12. Retrospective

**Did `Analyst.md` catch anything not thought about up front?** Yes — and the
most useful catch was of this document's own error. Deciding to *execute* every
prescription before writing it down (§4) exposed, within the first ten minutes,
that the draft's fix for `routes/index.ts:175` could not work and was a repeat
of a lesson Phase 1 had already paid for. That became **L-016**. Three smaller
findings came the same way and none by reading: 13 of 41 violations are
autofixable and all are one rule (which made D1 possible); `eslint --fix`
output is prettier-dirty, so a step checking only ESLint reports success over a
tree that fails CI (D2); and the `?deckId=` empty-string case at
`routes/index.ts:93` genuinely is *not* equivalent under `!= null`, unlike the
superficially identical site Phase 2 argued away in its #7–8.

**Did anything in `tasks.md` turn out wrong during coding?** No step needed
rewriting — the third phase running to prescribe-then-execute and the second in
a row with no rewrites. Two process defects were mine, both caught at review
rather than by an executor:

- **A dispatch prompt had wrong arithmetic.** Step 6's prompt told the executor
  to expect 10 changed files when 11 was right, having forgotten Step 5's
  `routes/index.ts`. The executor listed the correct 11 and mislabelled the
  total. Harmless here, but it is the same class as the vacuous Done-when: a
  number in a prompt that nobody re-derived.
- **A gate blocked a legitimate edit, correctly.** Appending the Quick Tasks
  row via a shell heredoc was denied by the delegation hook, because the prose
  mentioned `server/src/middleware/auth.test.ts` and a heredoc counts as a
  write. The hook cannot parse which file a heredoc targets, so it treats any
  heredoc naming a protected path as a write to it. Using the file-edit tool on
  the `.md` (explicitly allowed) was the right route. Worth knowing rather than
  worth fixing.

**What the run cost, and the one thing that would have made it cheaper.** An
account spend limit killed the Step 6 executor mid-run. It died *before* making
any edit, which was verifiable in seconds because the step boundary was clean —
`transform.ts` unmodified, count still 10. That is the checkpoint discipline
paying for itself: the recovery question was "did it write anything?", not
"what state is the file in?". Each cold-started executor cost 26k–48k tokens
regardless of how small its step was, which is the argument for sizing steps by
*risk* rather than by uniformity — Steps 9 and 10 were deliberately merged
behind a hard gate for exactly this reason, and the trivially mechanical Steps
2 and 3 could have been merged too.

**The thing worth carrying to Phase 4.** Verify the executor's *artifact*, not
its report. Every step here reported success and every step was independently
re-checked at the top level — the guards re-grepped in `routes/index.ts`, both
`buildCard` branches read in full, the temp files confirmed deleted, the
`lint:ci` string read from `package.json`. All eleven reports happened to be
accurate, which is the outcome you can only know *after* checking. Phase 1 saw
four "all checks passing" reports over wrong work and Phase 2 caught a
confabulated file path; the difference in Phase 3 was not luckier executors but
prescriptions that had already been run.
