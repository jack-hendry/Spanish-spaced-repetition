# STATE: cli-version-flag

## Status
- **Phase:** specify
- **Current task:** none
- **Last updated:** 2026-07-06

## Completed
- [x] Spec written (awaiting approval)
- [ ] Plan written and approved

## Decisions log
- 2026-07-06: Feature initiated: add a --version flag to the cli
- 2026-07-06: SPEC.md written. Investigated repo for "the cli" — no existing
  CLI arg parsing beyond tools/convert_apkg.py (Python, argparse). Assumed
  target is server/src/import/cli.ts (the only file literally named "cli"),
  run via `npm run import`. Flagged as an open assumption in SPEC.md for
  human review.

## Next action
Pause for human approval of SPEC.md before proceeding to plan phase.

## Blockers
None
