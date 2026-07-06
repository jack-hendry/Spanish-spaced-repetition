# STATE: cli-version-flag

## Status
- **Phase:** plan
- **Current task:** none
- **Last updated:** 2026-07-06

## Original request
> add a --version flag to the cli

## Completed
- [x] Spec written
- [ ] Spec approved (human)
- [ ] Plan written
- [ ] Plan approved (human)

## Decisions log
- 2026-07-06: Feature initiated: add a --version flag to the cli
- 2026-07-06: SPEC.md written. Investigated repo for "the cli" — no existing
  CLI arg parsing beyond tools/convert_apkg.py (Python, argparse). Assumed
  target is server/src/import/cli.ts (the only file literally named "cli"),
  run via `npm run import`. Flagged as an open assumption in SPEC.md for
  human review.
- 2026-07-06: Migrated to fixed pipeline format: phase advanced to plan
  (spec exists, awaiting approval), checkboxes split into written/approved.

## Discovered
(empty)

## Next action
review SPEC.md, then /resume to run planner

## Blockers
None
