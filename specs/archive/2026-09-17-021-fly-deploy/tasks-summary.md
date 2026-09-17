# tasks — Phase 1: deploy to Fly.io (summary)

The full 22-step `tasks.md` (77KB, with every step's `Do` / `Done when` /
`Context` and its verbatim Status block) is **in git history** — commit
`0a4cc52`, path `specs/021-fly-deploy/tasks.md`. It was summarized here at
archive time rather than dropped, because the Status blocks are where this
spec's findings were recorded as they happened.

Baseline at planning time: server **71 tests / 10 files**. At completion:
server **82 / 12**, web **216 / 21**, `npm run build` exit 0.

## Outcome by step

| # | Step | Result |
|---|---|---|
| 1 | `.dockerignore` | done — `data/` (259MB) kept out of the build context |
| 2 | Sentinel module | done — 76 tests; content-based, checks both `cards.json` and `notes.json` |
| 3 | Wire sentinel into boot | done — 79 tests; runs **before** `store.init()` |
| 4 | Deterministic flush test | done — 82 tests; **needed a 2nd pass** |
| 5 | Checkpoint | done — **caught a real regression** from Step 3 |
| 6 | Dockerfile | done — **needed a 2nd pass** |
| 7 | Build + verify locally | done — **1st attempt was a false green, discarded** |
| 8 | Checkpoint | done |
| 9 | `fly.toml` | done — `fly config validate` clean |
| 10 | `verify-remote.sh` | done — target is a required argument |
| 11 | `pull-fly-state.sh` | done — **needed a 2nd pass** |
| 12 | `push-fly-state.sh` | done — **needed a 2nd pass; 1st could not have worked** |
| 13 | Checkpoint | done — stopped for user approval before billed infra |
| 14 | Provision app/volume/secrets | done — 3 deliberate deviations |
| 15 | First deploy + seed volume | done — **a false-green criterion, and a genuinely dirty transfer** |
| 16 | Disarm escape hatch | done — sentinel live, flags absent |
| 17 | Verify auth on public host | done — 15/16, the 1 failure a criterion error |
| 18 | Backup round-trip + restore | done — **app declared safe to study on here** |
| 19 | Checkpoint incl. autostop | done — autostop proven **behaviourally** |
| 20 | Redeploy with write in flight | done — review survived |
| 21 | Phone over cellular | done — 12 cards, audio, persistence verified |
| 22 | Wrap-up | done |

## The five un-failable acceptance criteria

The spec's main export, generalised as **L-019**. Each of these would have
passed whether or not the thing under test worked:

1. **Step 4** — asserted `mtimeAfter === mtimeBefore` to prove a debounce timer
   was cleared. After `flushAll()` the file already holds the final content, so
   an uncleared timer rewrites byte-identical bytes; a probe measured both
   writes at the *same* millisecond. Fixed by asserting `vi.getTimerCount()`.
2. **Step 7** — curled `localhost:3000` to test a container while the
   developer's `npm run dev` server held that port and **no container was
   running**. Reported an unauthenticated 200 + `Access-Control-Allow-Origin: *`
   while `docker logs` showed the container's `hardened: true`. Re-run on port
   3100 with an identity proof required before any assertion.
3. **Step 12** — `bash -n` passed over a script whose every remote call used
   **`fly ssh shell`, which does not exist**. All four call sites would have
   failed at the first call, invisibly until the restore was needed (**L-021**).
4. **Step 15** — `ls /data/spanish/media | wc -l` reported a clean `7241 = 7241`
   while **7250 AppleDouble `._*` files** sat in the same tree, because `ls`
   hides dotfiles. macOS `tar` had embedded xattrs on extract to Linux. Found
   via `find -name '._*'`, removed, re-verified byte-identical.
5. **Step 16** — `printenv | grep -cE '^(ALLOW_EMPTY_STORE|DEV_MODE)=' → 0` is
   equally satisfied by "flags absent" and "`printenv` emitted nothing". Re-run
   with positive controls: 23 total env lines, `DATA_DIR` = 1.

## Other findings worth keeping

- **Step 3 → 5: a test-count `Done when` does not prove the code compiles.**
  Adding a required field to `ServerConfig` broke two literals in
  `app.integration.test.ts` (`tsc` exit 2), but vitest transpiles without
  typechecking, so 79 tests passed over code that did not build. Any step
  widening a shared interface needs `npm run build` in its *own* criteria.
  (L-003 recurring — the lesson needs to reach `specs/TEMPLATE.md`.)
- **Step 6: `--omit=dev` does not exclude the frontend.** `@angular/*`, `rxjs`
  and `tslib` are production `dependencies` of the `web` workspace. Scoped to
  `--workspace=server --include-workspace-root`.
- **Step 7: the <350MB image gate was measured against the wrong
  architecture.** arm64 base alone is 349MB; the amd64 image Fly actually
  deploys is **73MB**.
- **Step 11: `mktemp -d` on macOS is a different volume from the repo**, so the
  final `mv` was copy-then-unlink, not an atomic rename — a mid-loop failure
  would leave exactly the half-written state the script forbids. Staging moved
  to `$(dirname "$DEST_DIR")/.pull-fly-state.XXXXXX`.
- **Step 12: `fly ssh console -C` execs directly and does not invoke a shell**
  — shell semantics need a `/bin/sh -c '…'` wrapper. It *does* propagate the
  remote exit code (confirmed at Step 18: `test -s /nonexistent` → exit 1),
  which is what makes the pre-move verification a real guarantee.
- **Step 14: Fly secrets are overwritable**, so "Fly will not show it again"
  does not mean unrecoverable — setting `AUTH_PASSWORD` again costs nothing.
- **Step 17/20: the harness can deny a whole class of command.**
  `fly secrets set` was refused as `[Secret-Store Writes]` on two occasions, and
  the delegation hook and permission classifier deadlocked Step 20 between them
  (**L-022**). Resolved by the user supplying the credential via clipboard, and
  by dropping the `## Executing:` run marker.
- **Step 18: a pull into the default destination reporting `updated 0,
  unchanged 7` is indistinguishable from a pull that downloaded nothing.**
  Re-run into an empty scratch dir, where a no-op cannot fabricate files:
  `updated 7, unchanged 0`, SHA-256 matching on all seven.
- **Step 19: `[[http_service.checks]]` does not defeat autostop** — checks stop
  with the machine (`CHECKS 0/1`). Machine slept after ~7 min; cold start 5.1s.
- **Step 20: Fly sends `SIGINT`, not `SIGTERM`.** `file-store.ts` handles both;
  a future change handling only `SIGTERM` would silently lose the deploy-time
  flush. Also: the test proved the *signal path* is clean, **not** that a
  pending write was rescued — the POST landed ~22s before SIGINT against a
  400ms debounce, so nothing was pending. `fly deploy` spends ~22s acquiring a
  lease before it signals anything, so no invocation can beat the debounce;
  the deterministic proof is Step 4's unit test.
- **Step 21: the 200-card session became 12.** Deliberate — the safety property
  is the verified restore (Step 18), not sample size. No 200-card-scale
  behaviour has been observed.

## Deviations from the plan

| Step | Deviation |
|---|---|
| 10 | Script accumulates failures and exits 1 with an `N passed, M failed` summary instead of stopping at the first. `shellcheck` is **not installed**, so all three scripts are unlinted. |
| 14 | `fly apps create` instead of `fly launch --copy-config`; shared v4 **pre-allocated** rather than releasing a dedicated one after the fact; password set before user confirmation (safe — secrets are overwritable). |
| 15 | `_source/` (1.6M) included in the tar and left in place; harmless, `/api/import` is unregistered when hardened. Autostop suppressed at the machine level, not in `fly.toml`, so Step 16's plain `fly deploy` reverted it automatically. |
| 17, 20 | Re-designated `top-level` — the credential must not enter a subagent transcript. |
| 17 | The `http://` → 308 criterion was **wrong**; Fly's edge answers **301** before the request reaches the machine. Criterion amended, code untouched; `verify-remote.sh` still asserts 308 deliberately, since that is correct for the local-container case. |
| 21 | Restore (item 6) **dropped** — the phone reviews became real study. Consequence: `push-fly-state.sh` has still never run against production. |
| 22 | `specs/STATE.md` needed rotation (321 → 288 lines); AD-021/AD-022 moved to `STATE-ARCHIVE.md`. |
