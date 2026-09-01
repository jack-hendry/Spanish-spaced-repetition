# Analyst — Phase 3: `server/src` lint remediation

Phase 3 of [`specs/archive/2026-08-31-015-typescript-lint-rollout/ROADMAP.md`](../2026-08-31-015-typescript-lint-rollout/ROADMAP.md).
Follows Phase 1 (archived) and Phase 2 (archived).

Sized **Large** — not for volume (41 violations, 11 files, the smallest
phase) but because two files own scheduling state: `routes/index.ts`
(`/collection/resume` writes `card.due` for every card in the payload;
`/review` persists the card the SPA just scheduled) and
`import/transform.ts` (`walk` mints a new card's `due` position and its
SM-2/FSRS defaults, and preserves a re-imported card's prior scheduling
state). Both carry violations whose "obvious" fix is behaviour-changing —
that is the content of this phase; the other nine files are routine.

*Archived summary. Full step-by-step execution log and harden-round detail
have been removed; the decisions, fixes, and findings below are the durable
record. See `specs/STATE.md` for AD entries and L-013/L-014/L-015/L-016.*

## Problem

`server/src` was the last unclean directory in the repo. Phase 0 attributed
102 baseline violations to it; Phase 1's global calibration
(`eqeqeq`, `restrict-template-expressions`, five test-scoped rules) took
that to **41 across 11 files, 9 rules** without touching server code. Phase
2 left it untouched at 41. Phase 3 clears those 41 and gates `server/src`,
after which Phase 4 has only the repo-root and `tools/` surface left.

## Scope

**In:** fix all 41 violations; gate `server/src` in `lint:ci`; re-baseline
`INVENTORY.md`/`ROADMAP.md`.

**Out:** `web/src` (already zero); any rule change (`eslint.config.mjs`
untouched — calibration happened once, in Phase 1, on evidence);
`noUncheckedIndexedAccess` (off in `server/tsconfig.json` — the root cause
of 4 `no-unnecessary-condition` false positives below; turning it on
re-types every array index in both workspaces, its own spec — recorded for
Phase 4); any behaviour change (all 41 got a behaviour-preserving fix); the
adjacent test-quality defect found below.

## Method: every prescription was executed before being written down

Phase 1's retrospective found two of four "confirmed" harden verdicts did
not survive execution; Phase 2 responded by running its three risky claims
before prescribing them. This phase took that further: **all 41 fixes were
applied, linted, type-checked, formatted and tested in a worktree, then
reverted**, so `tasks.md` prescribed diffs that had already compiled and
passed. That caught a real defect in this document's own first draft (see
Discovered) — the reason to keep doing it.

## What reading all 41 sites found

**13 of 41 are autofixable, all one rule** (`no-confusing-void-expression`).
Four sites are not mechanical:

**(a) `routes/index.ts:74`** — `for (const update of cardUpdates ?? [])`.
The body's cast types `cardUpdates` as required, so `??` reads as dead
code. It isn't: the cast asserts something about untrusted request input,
not a fact. Fix: make the cast honest (`cardUpdates?:`), never delete the
fallback — this endpoint bulk-writes `card.due`, and deleting it makes a
request that omits the field throw mid-loop after cards are already
mutated in memory.

**(b) `routes/index.ts:119`** — same shape (`if (revlog) await
store.appendRevlog(revlog)`), two rules from one guard. Same fix:
`revlog?: RevlogEntry`.

**(c) `routes/index.ts:175`** — the deck fallback chain, the predicted
`server/src` instance of the trap Phase 1 found in `template-renderer.ts`.
Without `noUncheckedIndexedAccess`, `existing[0]` and
`store.getDecks()[0]` type as never-`undefined`, so both `??` fallbacks
look unreachable. They aren't: `existing` is empty for a note's first
card, `getDecks()` is empty on a fresh store. Deleting them hands
`undefined` to `reconcileNoteCards`'s `deckId`. Fix: `.at(0)` — same
instrument as Phase 1's `review.ts:135`.

**(d) `import/transform.ts:176`** — `walk` at complexity 17 (max 15). The
only violation requiring decomposition rather than a line edit. A careless
extraction could reorder `newCardPosition++` relative to the card push, or
drop a field from the preserved-vs-fresh branch, with no type-check
failure either way — see the corpus-equivalence proof below.

## Key fixes (representative, not exhaustive)

| Site(s) | Rule | Fix |
|---|---|---|
| `app.ts`, `middleware/auth.ts`, 4 test files (13 sites) | `no-confusing-void-expression` | `eslint --fix`, diff read by hand (D1) — every hunk including the security-relevant early-return in `auth.ts`. Then `npm run format` (D2). |
| `routes/index.ts:74,119,175` | `no-unnecessary-condition` (+`strict-boolean-expressions`) | (a)/(b)/(c) above. |
| `routes/index.ts:93` | `strict-boolean-expressions` | `deckId ? filter : all` → `deckId != null && deckId !== ''`. **`!== ''` is load-bearing**: `?deckId=` yields `''`, and `!= null` alone would send it to the filter branch (matching no card, returning `[]`) instead of "all cards". |
| `transform.ts:27,124,144,146,184,255` | `no-non-null-assertion` (6 sites) | Mixed: Phase 2's `has()`+`get()!` → one `get()` pattern (3 sites); `order: string[]` → `Deck[]` (removes the assertion by removing the cross-structure invariant it stood for); one real `throw` (seed constant key, no structural fix exists); one inline `Array.isArray` narrow. |
| `transform.ts:82,87` | `strict-boolean-expressions` | `!!v` → `v != null && v !== ''` — exact equivalent, `v` is `string \| null \| undefined`. |
| `transform.ts:208` | `restrict-plus-operands` | `'c'+guid+'-'+ord` → `` `c${guid}-${ord}` ``. **This is the card-identity contract** (`python-pipeline`: `c{guid}-{ord}`) — byte-identical for integer `ord`, proven by the corpus diff below rather than asserted. |
| `transform.ts:176` | `complexity` | (d) — extract `buildNote`/`buildCard`; `newCardPosition` passed in, advanced by the caller only when no prior card existed, preserving exact `due` sequencing. |
| `index.ts:35,36,39` | `no-misused-promises`, `use-unknown-in-catch-callback-variable` | SIGINT/SIGTERM listener → sync, wraps async body in `void (async () => …)()` — the `flushAll()` shutdown path stays fire-and-forget exactly as before. |
| 3 integration test files (3 sites) | `no-misused-spread` | Shared `api()` header-merge helper: object-spread over `HeadersInit` silently drops values when the input is `string[][]` (numeric-index collision) — a real catch. Fixed with `new Headers(init?.headers)`. |
| `auth.test.ts:79` | `no-misused-promises` | Sync `listen()` wrapping a voided async IIFE — see Discovered for what this deliberately preserves. |

## Verified effect

All 41 applied together, then reverted: `eslint server/src` 0 (from 41);
`tsc --noEmit` clean; `format:check` clean (after `npm run format` — D2);
`npm test -w server` 71 passed; repo total **280** tests unchanged.

**The importer needed more than a green suite.** `transform.test.ts`'s 9
tests don't pin identity across a whole corpus, and the fixes touch
card-id construction and new-card `due` sequencing. So the refactor was
checked by **differential testing**: pre- and post-change `transformBooks`
run side by side over the real `data/spanish/_source/` corpus (**3,638
scraped cards**), comparing full `JSON.stringify` output. Three scenarios —
cold import, re-import over existing scheduling state, re-import with
gaps (fresh cards minted interleaved with preserved ones, the one that
would catch a `newCardPosition++` drift) — all byte-identical.
**Negative-controlled**: perturbing `ease: 2500 → 2400` failed exactly the
2 of 3 scenarios that reach the fresh-card branch, confirming the harness
actually exercises what it claims. Not committed (depends on a copy of the
pre-change module with no lasting meaning); described here to be rebuilt
if needed.

## Decisions

**D1 — `eslint --fix` used for one rule, diff read by hand.** 13 of 41
(32%) are `no-confusing-void-expression`, purely syntactic
(`return f();` → `{ f(); return; }`). Autofix, then read every hunk —
including the three in `middleware/auth.ts` where the early-return
structure is security-relevant and was confirmed preserved exactly.

**D2 — Autofix must be followed by `npm run format`.** The fixer emits
`{ next(); return; }` on one line, not prettier's style, so
`format:check` fails on exactly the files `--fix` touched. A step that
checks only ESLint reports success over a tree that fails CI.

**D3 — The gate becomes `web/src server/src`, two paths, not a grown
list.** Phase 2 found nine clean-but-ungated files that violation-sized
batching had silently skipped and collapsed to one directory for that
reason. Phase 3 does the same from the start: any server file with zero
violations today or in the future is covered by the directory, not by
having been remembered.

**D4 — The Done-when asserts on the script's text, not just its exit
code (L-015).** `npm run lint:ci` exits 0 whether or not a step actually
widened it, since everything already named is already clean. The
Done-when greps `package.json` for the literal path string *and* runs the
gate.

**D5 — No `eslint-disable` anywhere.** All 41 got a real fix; none needed
suppression.

## Discovered

- **This document's own first draft prescribed a fix that cannot work —
  a repeat of a recorded lesson.** For (c) it specified
  `const firstExisting: Card | undefined = existing[0]`. Applied, that
  made things *worse* (2 violations → 4): TypeScript narrows a `const` to
  its initializer's type regardless of the annotation. Phase 1 hit the
  identical wall and the repo already had the working instrument
  (`.at(0)`, from `review.ts:135`). Reasoning about the fix reproduced a
  known-bad answer; running it took 40 seconds to refute. → **L-016**: a
  harden pass must re-derive, not re-reason — an unexecuted prescription
  is a hypothesis.
- **`auth.test.ts:79`'s test hangs rather than fails**, unrelated to this
  phase's lint fix, deliberately not fixed here (scope discipline — a
  test-quality bug, not a lint fix). The assertions inside its `listen`
  callback are fire-and-forget: if the status assertion throws, the outer
  `new Promise` never resolves and the test times out instead of
  reporting the assertion. The `no-misused-promises` fix preserves this
  exactly, by design (behaviour preservation). Proper fix: reject the
  outer promise from a `catch`. → Quick Tasks in `specs/STATE.md`.
- **`noUncheckedIndexedAccess` off is the root cause of the `??`-is-dead
  false positives** — 4 of this phase's violations exist only because an
  out-of-bounds index types as present. `.at(0)` fixes them one site at a
  time; the flag would fix the class, but re-types every array index in
  both workspaces — Phase 4's call or its own spec.
- **Phase 3 inherits none of the `no-unsafe-*` test-file debt** deferred
  by Phase 1 — `server/src` has zero such violations, so that deferral
  reaches only `web/`.

## Result

`npx eslint server/src` → **0** (from 41). `lint:ci` is
`eslint web/src server/src`. `format:check`, `tsc --noEmit`, and
`npm run build` all clean. **280** tests unchanged from first step to
last. No `eslint-disable` in either workspace. `web/src` untouched
(`git diff --name-only origin/main..HEAD -- web/src` empty). Importer
refactor proven by corpus equivalence with a working negative control, not
by unit tests alone. **Repo-wide, across all four phases: 254 → 0.**

**Retrospective, condensed:** no `tasks.md` step needed rewriting during
execution — the second phase in a row with no rewrites, because every
risky claim was run before being prescribed rather than reasoned about.
The carry-forward lesson for future harden passes: verify the executor's
*artifact*, not its report — every one of this phase's 11 steps was
independently re-checked at the top level (guards re-grepped, both
`buildCard` branches read in full, temp files confirmed deleted, the
`lint:ci` string read from `package.json`), and all eleven reports
happened to be accurate, which is only knowable after checking. Phase 1
saw four "all checks passing" reports over wrong work; Phase 2 caught a
confabulated file path.
