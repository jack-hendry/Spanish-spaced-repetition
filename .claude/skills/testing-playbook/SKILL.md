---
name: testing-playbook
description: Where a new test belongs, how each workspace's runner is invoked, temp-dir isolation for server tests, and the definition of done for an SDD task. Read before writing tests or checking off a task.
---

# Testing playbook

Verified against source 2026-07-07. If code and this file disagree, trust the
code and update this file. Raw commands live in CLAUDE.md — this covers the
choices and gotchas.

## Where does the test go?

| What you changed | Test file | Style |
|---|---|---|
| Pure logic in `web/src/app/core/` (scheduling, limits, search, stats, templating) | colocated `*.spec.ts` | plain vitest imports, tiny factory helpers, no TestBed |
| Server store / importer / card generation | colocated `*.test.ts` | plain vitest |
| REST routes end-to-end | `server/src/routes/*.integration.test.ts` | real Express + `FileStore` on a temp dir, `fetch` against `app.listen(0)` |

Note the naming split: **`.spec.ts` in web, `.test.ts` in server.** The
runners discover by these patterns; a misnamed file silently never runs.

Prefer the first row: if a behaviour can be expressed as a pure function in
`core/`, put it there and test it there (see [[angular-conventions]]). Model
the test style on an existing neighbour — e.g. `core/daily-limits.spec.ts`
(factory helpers like `card(over)` filling every `Card` field) or
`server/src/routes/notes.integration.test.ts`.

## Server test isolation

Never point a test at the live `data/spanish/`. Two mechanisms:

- Construct the store directly on a temp dir, and kill the write debounce so
  asserts see files immediately:
  `new FileStore(mkdtempSync(join(tmpdir(), 'srs-')), { debounceMs: 0 })`
  (see `notes.integration.test.ts`; `rmSync(dir, { recursive: true })` in
  `afterAll`).
- Code that resolves paths itself (import runner/CLI) honours the `DATA_DIR` /
  `SOURCE_DIR` env overrides from `server/src/paths.ts`.

## Runner facts

- Server: bare `vitest run` (no config file — default discovery of
  `*.test.ts`). Filter by file (`npm test -w server -- transform.test.ts`) or
  by name (`-- -t "pattern"`) for the fast loop.
- Web: `ng test` through the `@angular/build:unit-test` builder — vitest
  underneath, but always invoke via `npm run test -w web`, never `npx vitest`
  in `web/` (the builder wires TS paths and the browser-ish env).
- Both suites: `npm run test` at the root runs server then web.

## Definition of done (SDD tasks)

1. When the task's "done when" is testable, write the failing test first.
2. Full root `npm run test` green before checking the task off in STATE.md —
   never finish on a broken build, and never scope the final run to one file.

## Gotchas

- With `npm run dev` running, `data/spanish/` mutates constantly (debounced
  card saves). Dirty git state there is normal and is not a test failure.
- Forgetting `debounceMs: 0` in a server test makes file-content asserts
  flaky — the ~400ms card-save debounce may not have flushed.
- Scheduling changes: extend the colocated core specs (`sm2.spec.ts`,
  `fsrs.spec.ts`, `lifecycle.spec.ts`, …) — read [[scheduling-domain]] first
  for the unit traps (`due` overloading, permille ease, day numbers).
