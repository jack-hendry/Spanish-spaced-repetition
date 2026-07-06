# SPEC: cli-version-flag

## Summary

Add a `--version` flag to the repo's importer CLI (`server/src/import/cli.ts`,
invoked via `npm run import`) that prints the package version and exits
immediately, without running the import.

## Open Questions / Assumptions

This repo is primarily an Angular SPA + Express server, not a traditional
end-user CLI tool, so "the cli" is not self-evident. Investigation found no
existing argument parsing in `server/src/import/cli.ts`, and no `--version`
flag anywhere in the repo. Candidates considered:

- **`server/src/import/cli.ts`** — the only file in the repo literally named
  `cli.ts`; run via `npm run import`. **Assumed target of this spec.**
- `tools/convert_apkg.py` — a Python script with `argparse`, run via
  `python tools/convert_apkg.py <deck.apkg>`. Already has argparse wired up,
  so adding `--version` here would be cheap too, but it's not named "cli".
- `scrape.py` — a Python script with no argument parsing at all.

If "the cli" was meant to refer to one of the Python tools instead, this spec
should be revised before planning proceeds.

## Motivation

There's currently no way to check which version of the import tooling is
installed/running without opening `package.json`. A `--version` flag is a
standard, low-cost CLI affordance that helps with debugging (e.g. "did you
pull the latest before running import?").

## Behavior

- Running `npm run import -- --version` (equivalently `tsx server/src/import/cli.ts --version`)
  prints the version and exits with code `0`, doing **no** import work —
  it must not touch `data/spanish/` at all.
- The version string printed is read from `server/package.json`'s `"version"`
  field (currently `0.0.0`), not hardcoded, so it stays correct as the
  package version changes.
- Output format: a single line, e.g. `import-cli 0.0.0` (tool name + version),
  written to stdout.
- The flag is recognized in any argument position (e.g. first or only arg).
  No other flags/arguments are in scope for this feature — normal (no-arg)
  invocation continues to behave exactly as it does today.
- Unrecognized flags are out of scope for this change (no new validation of
  other args is required).

## Acceptance Criteria

1. `tsx server/src/import/cli.ts --version` prints a version line to stdout
   and exits with code 0.
2. Running with `--version` does not create, modify, or delete any files
   under `data/spanish/`.
3. The printed version matches the `version` field in `server/package.json`
   at the time of the run (verified by a test that stubs/reads package.json,
   or by importing the version constant directly rather than duplicating it).
4. Running the CLI with no arguments (`tsx server/src/import/cli.ts`)
   continues to behave exactly as before (unaffected regression check).
5. A server-side test (`npm run test -w server`) covers the `--version` path.

## Out of Scope

- Adding `--version` to `tools/convert_apkg.py` or `scrape.py` (Python
  tooling) — not addressed by this spec unless the assumption above is
  corrected.
- Any other CLI flags (`--help`, `--dry-run`, etc.).
- Changing how the server or web app report their own version (e.g. in the
  UI or an API endpoint).
