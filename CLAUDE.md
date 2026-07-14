# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Anki-style spaced-repetition flashcard app for learning Spanish. An Angular SPA (`web/`) is the brain — it owns all scheduling math and study-queue logic — while a thin Express server (`server/`) is a persistence layer over JSON files in `data/spanish/`. Content is seeded by scraping McGraw Hill's Language Lab (`scrape.py`) and by converting Anki `.apkg` decks (`tools/convert_apkg.py`), then normalised by an importer.

## Commands

Run from the repo root (npm workspaces: `web`, `server`).

```bash
npm install              # install both workspaces
npm run dev              # server (tsx watch, :3000) + Angular (:4200) in parallel
npm run build            # build server (tsc) then web (ng build)
npm run import           # normalise data/spanish/_source/*.json into the canonical store
npm run test             # server (vitest) then web (ng test)
```

The app is used at `http://localhost:4200`; the Angular dev server proxies `/api` and `/media` to `:3000` (see `web/proxy.conf.json`).

Single tests / per-workspace:
```bash
npm run test -w server                       # all server tests (vitest run)
npm test -w server -- transform.test.ts      # one server test file
npm test -w server -- -t "name of test"      # by test-name pattern
npm run test -w web                          # all web tests (Angular unit-test builder, vitest under the hood)
npm run dev -w server                         # server only
npm run start -w web                          # web only
```

Python tooling (separate from npm):
```bash
pip install -r requirements.txt
python scrape.py                              # re-scrape McGraw Hill content into data/spanish/_source/
python tools/convert_apkg.py <deck.apkg>      # convert an Anki deck into source JSON + media, then run npm run import
```

## Architecture

### The split: scheduling lives in the frontend

The single most important design decision: **the server never computes scheduling.** SM-2 and FSRS math, the study queue, daily limits, and burying/lapse logic all live in `web/src/app/core/`. The server owns only *card structure* (which cards exist for a note) and *persistence*. When adding scheduling behaviour, it goes in the Angular `core/` modules; the server changes only if the on-disk shape changes.

The review loop: the SPA loads the collection + cards, the user rates a card, the chosen `Scheduler` produces a new card state + a `RevlogEntry`, and the SPA POSTs both to `/api/review` in one round-trip.

### Server (`server/`, ESM TypeScript, run via tsx)

- `store/file-store.ts` — `FileStore` owns `data/spanish/`. Loads everything into memory on `init()`; seeds foundational files (collection, notetypes, deckoptions) if the dir is empty. Writes are atomic (temp file + rename). Hot files like `cards.json` are **debounced** (`saveCardsSoon()`, ~400ms) so a burst of reviews coalesces into one rewrite; `revlog.ndjson` is append-only. `flushAll()` runs on SIGINT/SIGTERM so no review is lost.
- `routes/index.ts` — the whole REST API. `/collection` returns a bundle (collection + notetypes + decks + deckoptions); cards/notes have their own CRUD; `/review` is the combined card-save + revlog-append convenience; `/import` runs the importer.
- `cards/generate.ts` — `reconcileNoteCards`: given a note + note type, computes the card ords that *should* exist (one per template for standard types; one per distinct cloze number `N` at ord `N-1` for cloze types) and reconciles against existing cards — surviving ords keep their scheduling, new ords get fresh "new" cards, vanished ords are removed. Called on every note create/edit.
- `import/transform.ts` + `import/run.ts` — turn scraped McGraw-Hill "menu tree" book JSON into canonical decks/notes/cards. Identity is derived deterministically from `(bookSlug, Card_ID)` via a hash so **re-import reconciles in place and preserves scheduling state**.
- `models/index.ts` — the canonical data model and the contract between store, importer, and API. The Angular app mirrors these types in `web/src/app/core/models/`. Keep the two in sync.
- `paths.ts` — `dataDir()` / `sourceDir()`, overridable via `DATA_DIR` / `SOURCE_DIR` env vars (used by tests).

### Web (`web/`, Angular 22, standalone components + signals)

- Routes (`app/app.routes.ts`) are lazy-loaded features: deck list (`/`), `study/:deckId`, `options/:optionsId`, `browse`, `stats`.
- `core/collection.store.ts` — `CollectionStore`, a signal-based store holding the loaded collection + all cards, with computed per-deck due counts rolled up over subdecks. Decks are hierarchical via `::`-joined names.
- `core/study-queue.service.ts` — picks the next card honouring per-day new/review limits; ordering is due learning → due review → new.
- `core/scheduling/` — `SchedulerFactory.for(opts)` returns the `Sm2Scheduler` or `FsrsScheduler` per deck options; both implement the `Scheduler` interface in `scheduling/types.ts`. FSRS-5 default weights live in `server/src/store/seed.ts`.
- `core/templating/` — Mustache-ish card template rendering, cloze parsing, and type-in-the-answer grading.

### Data model essentials (`server/src/models/index.ts`)

- Ids are timestamp-based strings (Anki-style). Notes have a stable `guid` for re-import identity.
- A **note** (fields + tags) belongs to a **note type** (`standard` | `cloze`, with field defs, card templates, CSS). A note generates one or more **cards**; a card's `ord` is the template ord (standard) or cloze index (cloze).
- A card carries both SM-2 state (`ease` in permille, `interval` in days) and FSRS state (`stability`, `difficulty`, null until FSRS schedules it), so a deck can switch algorithms.
- `card.due` is overloaded by queue: position for `new`, epoch seconds for `learning`, day number for `review`. "Day number" = days since collection creation, honouring `collection.dayCutoffHour` (default 4am, like Anki) — see `todayNumber()`.

### Data directory (`data/spanish/`)

`_source/` holds raw scraped/converted book JSON (input to the importer). The canonical files (`collection.json`, `notetypes.json`, `decks.json`, `deckoptions.json`, `notes.json`, `cards.json`, `revlog.ndjson`) are written by the server and are the live store. `media/` (imported audio) is gitignored and regenerated by the converter.

## SDD Harness Rules

**Pipeline:** every feature moves through specify → plan → implement → done.
No phase is skipped, and no phase writes files outside its role
(specify/plan never touch source code; implement never touches
SPEC.md/PLAN.md except to read them). The critic agent reviews
SPEC.md and PLAN.md before each human gate, and runs a drift audit
when the last task completes; it writes only specs/{feature}/CRITIQUE.md
and its REVISE verdict informs the human — it never auto-loops a
phase or replaces the gate.

**State is the source of truth.** Conversation context is disposable;
specs/{feature}/STATE.md is not. Any phase that changes the state of
the feature (completes a task, hits a blocker, makes a scope decision)
must update STATE.md before ending its turn. If it's not written to
disk, it didn't happen.

**Phase gates require human approval.** After SPEC.md and after
PLAN.md, stop and wait — do not auto-advance into the next phase.
Task-to-task transitions in the implement phase need no formal
review gate, but /resume still runs exactly one task per invocation
and checks in with the user before starting the next.

**Entry points:**
- `/feature {description}` — starts a new feature at phase=specify
- `/resume [feature-name]` — reads STATE.md and continues from exactly
  where it left off; use this after every /clear or new session

**Model routing for this pipeline:**
- spec-writer, planner, critic: inherit the main-session model (no `model:`
  in their frontmatter — run the main session on Fable/Opus for these phases)
- implementer: `model: sonnet` in its frontmatter is only the fallback.
  The planner rates every task `Complexity: low | medium | high` (rubric
  in planner.md: low = 1–2 files, fully specified from the plan text
  alone; medium = 2–4 files following existing patterns; high =
  cross-cutting restructure or scheduling/data-model contract), and
  /resume overrides the model per task via the Agent tool's `model`
  parameter: **low → haiku, medium → sonnet, high → opus**.
- The planner also tags each task with a `Skills:` line naming the repo
  skills (angular-conventions, scheduling-domain, testing-playbook,
  python-pipeline) the implementer must read before coding; the
  implementer honours it as its first act, and the critic's plan mode
  checks both lines exist and fit the rubric.
- Keep effort at medium for implementer; use high for planner on
  complex features

**Scope discipline:** if any subagent notices unrelated issues, log
them under a "Discovered" section in STATE.md — do not fix them
inline. Drift is the main failure mode this harness exists to prevent.

**Lessons capture:** while implementing, log durable gotchas in the
feature's STATE.md under `## Pitfalls`, alongside `## Discovered`.
Litmus: Discovered = "someone should fix this later" (out-of-scope
work); Pitfall = "future me will trip on this again" (durable
knowledge). The critic's end-of-feature drift audit append-promotes
durable Pitfalls into the matching skill's `## Lessons (auto-appended)`
section (dated, append-only, duplicates skipped); pruning and merging
Lessons is human-only.

**When context is getting long:** update STATE.md fully, tell the user
it's safe to /clear, and that /resume will pick up correctly.