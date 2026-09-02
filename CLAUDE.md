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
- `config.ts` — the fail-safe env contract: `AUTH_USER`, `AUTH_PASSWORD`, `DEV_MODE`, `PORT`, `BODY_LIMIT`, `DATA_DIR`. In production (hardened mode), the server refuses to start without `AUTH_USER` and `AUTH_PASSWORD` set.
- `app.ts` — the middleware stack in order: `GET /api/health` is registered first and is the one deliberately anonymous route; then, only if hardened, `forceHttps` (loopback-exempt) → `helmet` → two `express-rate-limit` tiers → `basicAuth`; `express.json` sits **after** auth on purpose (so an unauthenticated request never gets a body parsed); then `/media` static, `/api` routes, and (if built) the Angular app + SPA fallback.

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
- `card.due` is overloaded by queue: position for `new`, epoch **milliseconds** for `learning`/`relearning`, day number for `review` (AD-003 — the "epoch seconds" this line used to claim was never true; see L-001). "Day number" = local calendar days from the study day of `collection.created`, rolling over at `collection.dayCutoffHour`:00 local (default 4am, like Anki) — see `todayNumber()`.

### Data directory (`data/spanish/`)

`_source/` holds raw scraped/converted book JSON (input to the importer). The canonical files (`collection.json`, `notetypes.json`, `decks.json`, `deckoptions.json`, `notes.json`, `cards.json`, `revlog.ndjson`) are written by the server and are the live store. `media/` (imported audio) is gitignored and regenerated by the converter.

## Working agreement

- Never commit anything (`git commit`, `git push`, etc.) without the user's explicit permission for that specific commit. One carve-out: a subagent running a `tasks.md` step in its own `isolation: "worktree"` branch may commit freely on that throwaway branch — that is what makes the merge and the scope check possible. Merging into the working branch, and every commit on it, still needs explicit permission.
- Read the relevant existing code before making changes — don't edit blind.
- If an implementation attempt fails twice, stop and explain the problem instead of continuing to retry.
- **Pipe bulk output before it lands in context.** Prefer `head`, `wc -l`, `grep -c` or a single `--json` field over `cat`-ing a whole file or `ls`-ing a whole tree. 99.5% of this repo's token spend is context re-read every turn, so an unfiltered dump is not a one-turn cost — every later turn re-reads it (19 such turns carried 27% of one session's input; L-017). `specs/SESSION-HYGIENE.md` is the operator-facing companion — a reference for the human, not required reading here.
- **Read the matching skill first.** `.claude/skills/` holds this repo's domain contracts: `scheduling-domain` before anything touching scheduling, the study queue, card generation or the card data model; `angular-conventions` before any file under `web/src/app/`; `python-pipeline` before `scrape.py`, `tools/convert_apkg.py`, the importer, or any `_source/*.json` shape; `testing-playbook` before writing tests or calling a task done. A `tasks.md` step that needs one says so.
- When executing steps from a `tasks.md` file, use the model specified in that step's `Model:` field. Each step names its executor; see `specs/TEMPLATE.md` for the selection table. Allowed values are `haiku`, `sonnet`, `top-level` — **never `opus`**.
- `tasks.md` steps run sequentially by default. Two steps may run in parallel only if neither `Depends on` the other **and** their `Files` lists share no file at all — same file in two steps means sequential, since git merges non-overlapping edits to one file without a conflict. See "Running steps in parallel" in `specs/TEMPLATE.md` for the worktree protocol, the pre-merge scope check, and what it still cannot catch.
- **A worktree dies with its branch, and a worktree you did not just create is guilty until proven clean.** When a branch merges, `git worktree remove` its worktree — not `rm -rf`, which leaves `.git/worktrees/<name>/` behind and a phantom row in `git worktree list` until someone runs `git worktree prune`; `git worktree unlock` first if it is locked. Removing a worktree does **not** delete its branch, so follow it with `git branch -d <branch>` — `-d`, never `-D`, so git refuses if it turns out not to be merged. On entering any pre-existing worktree, run `git diff --cached --quiet` **before** committing anything from it: a kept worktree whose branch ref has moved on shows a `git status` full of staged deletions that is indistinguishable from a deliberate revert, and committing over it silently reverts the merged work (AD-017, L-010). Nothing is needed on the creation side — `worktree.baseRef` is unset, so `EnterWorktree` already branches from `origin/main`.
- Project memory lives in `specs/STATE.md`: architectural decisions (`AD-NNN`), blockers (`B-NNN`), lesson headlines (`L-NNN`), Quick Tasks. Append-only, never renumbered. Aged `AD`/`B` entries move to `specs/STATE-ARCHIVE.md` leaving a one-line stub; **lesson headlines never move**, but their bodies live in `specs/LESSONS.md` — write both, or the pre-push hook refuses the push. Root `STATE.md` is only the run marker the hook greps for (AD-008).
- **Two homes for lessons, split by audience.** A *project or process* lesson is an `L-NNN` pair (`specs/STATE.md` headline + `specs/LESSONS.md` body) and is the only kind the pre-push gate enforces. A *domain* gotcha that belongs next to the rules it qualifies is appended, dated, to the matching skill's `## Lessons (auto-appended)` section instead. When in doubt: would a future reader hit this while reading the skill, or while planning a feature? (AD-009)
- **Scope discipline.** If you notice an unrelated problem mid-task, write it down — a `## Discovered` note in the spec, or a Quick Tasks row — and do not fix it inline. Drift is the main failure mode this harness exists to prevent.
- **`data/spanish/` is live state, not source.** The running server rewrites it on every review, so `npm run dev` alone dirties the tree. Check `git status` and `git checkout -- data/spanish/` before any closing commit (L-002).
- End-of-feature ritual, in order: (1) update any docs the feature touched, (2) confirm the `AD`/`B` entries and `L` headlines the spec produced are recorded in `specs/STATE.md` — durable findings should already be there, written as they happened (`specs/STATE.md` Rule 6); add anything missed here, with each lesson's body in `specs/LESSONS.md`, (3) **summarize the spec down to what matters** — the final `Analyst.md`, the decisions, and what changed from the plan; delete drafts and long back-and-forth notes so the archived folder is small, (4) move the summarized folder to `specs/archive/YYYY-MM-DD-<name>/` and push both the archive move and the `STATE.md` update together. A `pre-push` git hook (`scripts/clean-table-check.sh`, wired via `.pre-commit-config.yaml`) enforces steps 2–4: it blocks a push that adds files under `specs/archive/` without a matching `specs/STATE.md` change, and blocks any newly archived file over 20 KB with "Summarize this spec before archiving." A third gate runs on **every** push, not just archive pushes: every `L-NNN` headline in `specs/STATE.md` must have a body in `specs/LESSONS.md` and vice versa, so the two cannot drift. A fourth, also on every push, checks `specs/STATE.md` against its ~300-line size budget via `tools/state_rotate.py --check`; the hook only ever runs `--check`, never `--apply`, so it reports and refuses but never rewrites your memory file. A fifth, also on every push, requires every `### Step` in a changed `specs/*/tasks.md` to carry a `**Status:**` line (`specs/archive/**` is exempt — finished history); `scripts/clean-table-check.test.sh` is its regression matrix and CI runs it in the `hooks` job. The hook checks — it never edits or commits for you. It's a client-side git hook, so `git push --no-verify` bypasses it entirely; it's a reminder for the honest case, not a guarantee. **CI is the guarantee**: `.github/workflows/ci.yml` runs the *same script* on every pull request and every push to `main`, alongside `tests` (both workspaces + the build), `lint` (ruff) and `hooks` (the delegation-hook and Status:-gate test matrices). Never reimplement a gate's rules in the workflow YAML — one script, two callers, or the hook and CI drift into disagreeing about what "clean" means.
- Before starting a `tasks.md` run, add a `## Executing: <spec-dir-name>` line to the root `STATE.md`, and remove it when the run finishes. The `enforce-haiku-tasks-pretooluse.sh` hook keys off that marker to block direct top-level edits during a run — without it the hook stays dormant, so unrelated Small tasks are never blocked (L-004). The example marker in that file is indented by two spaces on purpose; un-indenting it silently disarms the hook (L-005).

## Task sizing rule (SDD)

Classify every task BEFORE starting. The size decides how much process it gets. Spec structure is documented in `specs/TEMPLATE.md`.

| Size | What it looks like | How to treat it |
|---|---|---|
| **Small** | 3 files or less, one sentence describes it | No spec. Fix it, verify it, add one row to Quick Tasks in `specs/STATE.md` |
| **Medium** | Clear feature, less than 10 steps, no new pattern | `Analyst.md` + `tasks.md` + 1 harden round (`CriticReview.md`) |
| **Large** | Touches more than one layer (e.g. server + data model + UI) | Full spec + 2 harden rounds + a review after coding |
| **Complex** | Ambiguous, new domain, or a pattern the project never used | Same as Large, but the critic focuses on the ambiguous parts |

Two rules that make this table work:

- When unsure, size UP, never down. Sizing down to "save time" is how bugs are born.
- If mid-work the task turns out bigger than classified (more steps, more layers), STOP and re-classify. Do not push through with too little process.

Anything touching scheduling, the study queue, `card.due`, or the on-disk shape is **at least** Large regardless of how few files it looks like — that is the contract `scheduling-domain` exists to protect, and a wrong day-number is silent (see `specs/archive/2026-07-14-007-heatmap-date-off-by-one` and `specs/archive/2026-09-02-010-day-rollover-anchoring`).

## Harness commands

```bash
pip install pre-commit && pre-commit install --hook-type pre-push   # one-time per clone
```

Without that, the clean-table pre-push hook is not installed and pushes are not checked.

```bash
python3 tools/archive_spec.py <spec-dir>          # ritual steps 3+4: plan the archive move (dry run)
python3 tools/archive_spec.py <spec-dir> --apply  # …and perform it; prints the STATE.md checklist
./tools/archive_spec.test.sh                      # regression matrix for the above
bash scripts/clean-table-check.sh                 # run the four push gates by hand
RANGE_OVERRIDE=main..HEAD scripts/clean-table-check.sh   # test them over any range
python3 tools/state_rotate.py --check             # is specs/STATE.md over its ~300-line budget?
python3 tools/state_rotate.py --apply             # rotate aged AD/B entries into STATE-ARCHIVE.md
./.claude/hooks/enforce-haiku-tasks.test.sh       # regression matrix for the delegation hook
./scripts/clean-table-check.test.sh                # regression matrix for the Status: gate
ruff check . && ruff format --check tools/state_rotate.py   # what CI's lint job runs
```

`state_rotate.py --apply` is run by a human who has decided to rotate; no hook ever runs it for you.
