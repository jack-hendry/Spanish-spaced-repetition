# Critic review — 025

## Round 1 (against `Analyst.md`, before `tasks.md`) — 2026-10-15

Fresh critic agent, read-only; every finding below was re-verified by the
top-level session against the cited lines before being folded in. Verdict:
**design holds; four must-fold findings, all folded into `Analyst.md`.**

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C-1 | SHOULD-FIX | A3 was hollow: old code also gives a ping-ponging op exactly 3 sends (reload, reload, budget park); only the reason string differs. | A3 now puts two one-shot conflicts *ahead* of A, so old code parks A on its first 409; also asserts `reapplies === 2`. |
| C-2 | SHOULD-FIX | "`Review.init()` reloads after draining anyway" is conditional (`review.ts:177` only when `pendingCount() > 0`). A drain finished before the session, or mid-session, leaves the reverted cache; `StudyQueue` reads `store.cards()` and can re-serve an answered card → reviewed twice. | Claim removed from §4; Discovered reworded; own Quick Tasks row. Not fixed here. |
| C-3 | SHOULD-FIX | `store.load()` swallows errors, so D1 would record a failed reload and leave the whole pass on stale options (→ `'unknown deck'` parks). | D1: record the pass only if `store.error() === null`. New A7. |
| C-4 | SHOULD-FIX (recommended) | Resolver reading `outbox.drainPass` makes its unit tests depend on the constructor's boot drain. DI is safe either way. | D1: `_runDrain` passes `pass` into the handler; `ConflictHandler` widens to a third param. |
| C-5 | NIT | D3 didn't place the reapply-limit check. | D3 order: path → limit → card → revlog → rating → reload → deck → options → collection. |
| C-6 | NIT | T19 in `outbox.service.spec.ts:753,777` uses `'reload budget exhausted'` as an opaque fake reason. | §3: change to a neutral string; A9 greps for none. |
| C-7 | SHOULD-FIX | A1/A4/A5 setup unspecified: no test wires the real resolver to a fake API; fake must provide `getCollection`/`getCards`. A4 should use a stateful fake, not scripted 409s. A5 passes on old code too. | §5 preamble pins the spec file, fake and seeding; A4 stateful; A5 labelled a regression guard. |
| C-17 | NIT | Write the `MAX_REAPPLIES` arithmetic out once. | Done in D2. |

**Cleared** (checked, fine — not to be re-litigated): C-8 fact 4's cascade
(`routes/index.ts:128-141`, `review.ts:298,311`); C-9 `reapplies` survives
every path and the `replacement` type admits it unchanged; C-10 one
`_runDrain()` is the right pass unit (retry and coalescing both start a new
one); C-11 A2 really red on old code; C-12 D3 ordering breaks no existing test;
C-13 removing the `effect()` is safe; C-14 handler registered before any
boot-time 409; C-15 `conflictCount` unchanged; C-16 coalesced `load()` is fine.

## Round 2 (against `tasks.md`) — 2026-10-15

Same critic agent, resumed. It confirmed the web baseline (290, exit 0) and ran
eslint `--stdin` over Step 2's proposed resolver. Round-1 fixes C-1, C-3–C-7
confirmed fixed in substance. C-18 re-verified against
`collection.store.ts:325-351`. All folded into `tasks.md`.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| C-18 | BLOCKING | The real `store.load()` runs `unburyForNewDay()`, which enqueues `PATCH /collection` when `lastUnburyDay` is absent, so the fake bundle would put an extra op mid-drain. The A1/A3 fakes then throw → `classify(null)` → retry backoff; A4's fake 409s it → parked as non-review. That breaks A1, A3–A6. | Fake bundle sets `lastUnburyDay: Number.MAX_SAFE_INTEGER`; every `send` fake returns `of({})` for paths other than `/review`; A1 asserts every path is `/review`; If-blocked updated. |
| C-19 | SHOULD-FIX | If the new spec imports `MAX_REAPPLIES`, running it against HEAD's resolver in Step 4 is an esbuild error for the whole file (A5 too), so A2 would be red for the wrong reason. | Step 3 forbids the import and uses literals; A3's name no longer says `MAX_REAPPLIES`. |
| C-20 | SHOULD-FIX | Step 2's lineage test reassigned `op` from `out.replacement` outside the TS narrowing, so it would not compile. | Reassignment moved inside the `if`, with `else throw`. |
| C-21 | SHOULD-FIX | Step 4's revert-and-restore was still exposed to L-034: the 120 s Bash timeout can kill it before restore; If-blocked used `$T`, which doesn't persist between calls; the temp-path wording didn't match the command. | `bash -c` with `trap … EXIT`, `timeout: 600000`, literal restore paths, one temp-path convention. |
| C-22 | NIT | Root `STATE.md` (the run marker) would trip Step 4's `git status` check. | Added to the allowed list. |
| C-23 | NIT | `npm test … \| tail` reports `tail`'s exit code (L-031). | Redirect to a file + `echo exit=$?` throughout. |

**Cleared:** C-24 every step stays green and the counts are 290 → 291 → 296;
C-25 Step 2's resolver code is lint-clean and loses nothing; C-26 the
synchronous-injection claim holds (`throwError` + `timeout` reject on a
microtask; `HttpErrorResponse.error` reaches the handler as the body); C-27
A1, A3, A4 and A6 are red on HEAD and A5 green, and Step 4's `×`/`FAIL` grep
tells them apart.
