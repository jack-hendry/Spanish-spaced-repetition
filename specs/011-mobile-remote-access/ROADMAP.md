# Roadmap — remote/mobile access

Status: pre-spec — this is a living planning doc, not yet `Analyst.md` +
`tasks.md`. Per the [task sizing rule](../../CLAUDE.md#task-sizing-rule-sdd)
this initiative is **Large** (touches server, deploy infra, and the web
layer), so each phase below gets its own proper spec (`Analyst.md` +
`tasks.md` + harden pass) when we're ready to execute it — this doc is the
map, not the plan.

## Goal

Be able to securley progress reviews from a phone when away from the desktop.
Desktop stays primary; phone use will be occasional, sometimes a full
~200-card session. Not solving for simultaneous desktop+phone use.

## Two non-negotiables

Every phase below is judged against these. If a phase would ship faster by
weakening either one, the phase gets longer instead.

1. **Security is paramount.** The moment this leaves localhost it is on the
   public internet. Nothing is reachable without authentication — API, app,
   and media alike — and no credential is ever committed. "It's just
   flashcards" is not a reason to expose an unauthenticated write API; the
   store is a single JSON tree that any caller can rewrite.
2. **Progress is never lost.** Years of scheduling state (`cards.json` +
   `revlog.ndjson`) is the irreplaceable asset — the content can always be
   re-scraped, the review history cannot. Every phase must leave the answer
   to "what would it take to lose a review?" *worse* than it was before.
   Losing scheduling state silently is the worst outcome in this project.

**Ordering rule:** Phases 0–2 must all land before the server is publicly
reachable. Phases 3–4 must land before the phone is trusted for a real
session — until then a phone session can silently drop reviews.

## Phase 0 — Server hardening (prerequisite for exposing anything)

The server today (`server/src/index.ts`) has no auth, a wide-open `cors()`,
and no production static-file serving — only the dev proxy splits API (:3000)
from Angular (:4200). Needed before anything touches the public internet:

- [x] Serve the built Angular app (`web/dist/...`) from Express so one
      process answers both `/api` and the app.
- [x] Add auth middleware in front of **everything** — `/api`, `/media`, and
      the static app — credentials from env vars/platform secrets, never
      committed. HTTP Basic is proportionate here because the data layer has
      no user model at all (genuinely single-user); decide at spec time
      whether the phone experience wants a signed session cookie instead of
      re-prompting. Constant-time credential comparison either way.
- [x] Lock `cors()` down to the real deployed origin instead of the open
      default.
- [x] Force HTTPS (redirect/refuse plain HTTP) — Basic credentials over
      cleartext would be sent on every single request.
- [x] **Contain `POST /api/import`.** It calls `store.replaceAll(...)`, so a
      single unauthenticated POST can rewrite the entire canonical store from
      whatever is (or isn't) in `_source/`. It should not be reachable from
      the deployed instance at all — disable it in production, or gate it
      behind a separate admin credential.
- [x] Trim the `express.json({ limit: '50mb' })` body cap to something the
      real payloads need, and add basic rate limiting — a 50MB unauthenticated
      body is a free memory/disk exhaustion primitive once public.
- [x] Add security headers (helmet or equivalent) and confirm nothing outside
      `data/spanish/media/` is reachable through the static mounts.
- [x] Verify by trying: unauthenticated `curl` against `/api/collection`,
      `/api/review`, `/media/...` and the app root must all fail.

**Phase 0 complete.** All 8 hardening checkboxes landed in `specs/013-server-hardening`
(the last two were done — helmet in `app.ts`, `verify.sh`'s curl matrix and
path-traversal check — but missed being ticked when this doc was updated).

## Phase 1 — Deploy to Fly.io

**Done 2026-09-17** — `specs/archive/2026-09-17-021-fly-deploy`, live at
`https://spanish-srs.fly.dev`.

- [x] Dockerfile + `fly.toml`. Two-stage build on `node:24-bookworm-slim`; the
      runtime stage runs a production-only install rather than copying the
      build stage's 287MB `node_modules`. Deployed image **73MB**. The trap
      worth remembering: `config.ts`/`paths.ts` compute `repoRoot` by walking
      two levels up from the compiled JS, so the runtime stage must preserve
      `server/dist` and `web/dist/web/browser` at their exact relative paths —
      a conventional flattening `COPY` yields `staticDir: null`, an app that
      404s while `/api` works perfectly.
- [x] Persistent volume mounted over `data/spanish/` so scheduling state
      survives redeploys/restarts (server writes here on every review —
      `store/file-store.ts`). 1GB `spanish_data` at `/data` (**not**
      `/data/spanish` — the app appends that), 261M used.
- [x] **Refuse to start on an unmounted/empty volume.** `FileStore.init()`
      seeds a fresh empty collection when the data dir is empty, so a
      misconfigured mount doesn't error — it silently starts a blank app and
      then persists that blank state. A sentinel check ("expected a populated
      store, found none → exit non-zero") turns the classic Fly data-loss
      story into a failed boot. Implemented as `server/src/store/sentinel.ts`
      — **content-based, not existence-based**, and checking `notes.json` as
      well as `cards.json`; see AD-026 for why both distinctions are
      load-bearing.
- [x] Configure auto-stop/auto-start so the machine sleeps between sessions
      — usage will be occasional, not continuous. **Verified behaviourally,
      not just in the config**: the machine reached `stopped` after ~7 minutes
      idle and cold-started in **5.1s** on the next request. A
      `[[http_service.checks]]` health check does *not* hold the machine awake
      — checks stop with the machine (`CHECKS 0/1`).
- [x] **Confirm graceful stop actually flushes.** `cards.json` writes are
      debounced (~400ms) and only `flushAll()` on SIGINT/SIGTERM saves them;
      an auto-stop that hard-kills the machine loses the last few reviews.
      Verify the stop signal and grace period are long enough for the flush.
      Deterministic proof is the unit test (`file-store.flush.test.ts`,
      asserting on `vi.getTimerCount()`); the deployed signal path was smoke-
      tested in Step 20 — clean exit code 0, volume unmounted cleanly.
      **Fly sends `SIGINT`, not `SIGTERM`** — `file-store.ts` handles both, but
      a future change that handled only `SIGTERM` would silently lose the
      deploy-time flush.
- [x] Automatic HTTPS on the `*.fly.dev` domain (free single-hostname cert,
      first 10 per org are free). Note plain `http://` is answered by **Fly's
      edge with a 301**, before the request reaches the machine; `app.ts`'s own
      308 remains as defence-in-depth.
- [x] Verify: data survives a redeploy ✅ (Step 20 — a card answered, then
      `fly deploy`; `interval` 1→3, `due` 72→87, did not return to the queue),
      phone can reach it over cellular ✅ (Step 21 — login, audio, and correct
      counts after a reload and re-login).
      ⚠️ **The "200-card session" was not performed** — the spec reduced it to
      ~20 as a smoke sample and the real run was **12 cards**. Deliberate: the
      safety property is the *verified restore* (Step 18), not the sample size,
      and 12 exercised both scheduler outcomes (8 graduating to `review`, 4 on
      a 10-minute learning step). No throughput or rate-limit behaviour at
      200-card scale has been observed.

**Cost estimate** (checked against [Fly.io's pricing page](https://fly.io/docs/about/pricing/) 2026-08-26):
shared-cpu-1x/256MB ≈ $2.02/mo if always-on, likely much less with
auto-stop given rare/occasional use. 1GB volume (minimum) = $0.15/mo —
current `data/spanish/` is 259MB, of which 252MB is the `media/` folder;
the actual scheduling state (`cards.json` + `notes.json` + `revlog.ndjson`)
is ~5.5MB and grows by roughly one small line per card reviewed, so even a
200-card day adds only a few KB. Bandwidth ($0.02/GB in US/EU) and the TLS
cert are effectively free at this volume. **Realistic total: ~$1–3/month.**

## Phase 2 — Backups and restore

`data/spanish/` is live state, not source (CLAUDE.md) — today it exists
only on this machine. Once it also lives on a Fly volume, a host/volume
loss becomes a real risk to the scheduling history. A Fly volume is a
single copy on a single host: it is not a backup.

- [x] Decide a backup mechanism, with at least one copy **off Fly** (periodic
      pull to this machine, a small cron job pushing elsewhere, Fly volume
      snapshots as a convenience layer — first 10GB/mo free per the pricing
      page). Snapshots alone don't survive losing the account or a bad write
      that gets snapshotted.
- [x] **Reconcile the Fly volume with the existing git-history workflow.**
      Today `data/spanish/*.json` + `revlog.ndjson` are tracked in git (only
      `media/` is gitignored) — commits like "Progress"/"Paused cards" are a
      running log of scheduling state, and rollback today means checking out
      an older commit. Once Fly writes to its own volume, that volume is a
      second live writer to the same logical state that isn't a git checkout
      at all — a phone session leaves Fly's state ahead of the repo, so the
      git-rollback habit silently stops covering the most recent reviews
      unless something closes the loop. Decide **which side is the source of
      truth** and make the backup mechanism *be* that reconciliation rather
      than a separate parallel format:
      - Fly-as-source: a scheduled job (cron on Fly, or a pull run from
        desktop) pulls the volume's state and commits it to the repo — this
        *is* the "at least one copy off Fly" bullet above, just made
        git-native so the existing rollback workflow keeps working, lagged
        by the pull interval.
      - Desktop-as-source: git stays authoritative and Fly syncs from/to it
        explicitly around each phone session — closer to today's habit, but
        it's a manual step someone can forget, which is exactly the kind of
        silent-divergence risk Phase 3/4 exist to close for other paths.
      - Whichever is chosen, write it down here before Phase 2 is marked
        done — an unstated answer means the next person (or agent) re-derives
        it mid-incident.
      - ✅ **DECIDED 2026-09-17: Fly-as-source** (`specs/archive/2026-09-17-021-fly-deploy`
        Analyst D0, AD-025). Settled during Phase 1 rather than Phase 2,
        because Phase 1 could not write a seed or a restore script without
        first knowing which side wins a conflict. `tools/pull-fly-state.sh`
        is the reconciliation: it pulls the seven state files into the repo so
        the existing git-rollback workflow keeps working, lagged by the pull
        interval. `tools/push-fly-state.sh` is the reverse path, for restore.
        **The desktop copy is no longer authoritative** — it is a lagging
        replica, and any local edit to `data/spanish/` is overwritten by the
        next pull.

**What Phase 2 still needs after Phase 1** — Phase 1 built the *mechanism* but
not the *policy*:

- ~~The pull is **manual**; nothing schedules it.~~ **Done 2026-09-17
  (spec 022):** `.github/workflows/backup.yml` runs it every 6 hours.
- ~~**`push-fly-state.sh` has never run against production.** It is dry-run
  tested and was exercised on a scratch round-trip in Step 18…~~
  **Both halves of that were wrong, and spec 022 corrected them by measurement:**
  - It was **never** "exercised on a scratch round-trip in Step 18". It *could
    not* have been — `local FILES_PUSHED=0` sat at function scope in a
    non-function context, so under `set -e` the script aborted at line 173
    before uploading a byte. Every dry run passed because `print_plan()`
    returned *before* that line: the dry-run mode took a different code path
    from the one nobody ran (spec 022 harden C1, Step 1). "Exercised in Step N"
    was a claim in a spec document; `git log` was the evidence, and they
    disagreed. See **L-025**.
  - It is now proven at **production scale**, not scratch scale. Spec 022
    Steps 12–15 restored all 7 state files (3,638 notes / 7,276 cards /
    3,915 revlog lines) into a throwaway Fly app
    (`spanish-srs-restoredrill`), matched every deck/note/card/queue/type
    count against production's recorded numbers, **studied one card against
    the restored app** so the restore is writable and not merely readable,
    and tore the app and its volume down. That run is the first time
    `push-fly-state.sh` has ever completed.
- ~~Retention is undecided~~ **Decided 2026-09-17 — see the retention
  checkbox below and `specs/STATE.md` AD-027.** The pull still overwrites the
  same seven files; what closed the gap is that `backup.yml` now commits them
  on a schedule, so history no longer depends on someone remembering.
- ~~Fly volume snapshots remain unconfigured.~~ **Corrected 2026-09-17 by
  measurement (spec 022 Step 16):** they were already configured
  (`Scheduled snapshots: true`, `Snapshot retention: 5`) but had produced
  *nothing* — wrong on configuration, right on outcome. The first snapshot
  (`vs_yeo71KGwpvPXTKZ25653LKp7`, 345 MiB) appeared 2026-09-17. They are a
  ≤5-day fast-rollback layer that lives on Fly, so they never satisfy the
  "at least one copy off Fly" non-negotiable.
- [x] Back up the *state*, not the media — `cards.json`, `notes.json`,
      `decks.json`, `collection.json`, `deckoptions.json`, `revlog.ndjson`.
      Media is 250MB and regenerable from the converter; state is 5MB and is
      not regenerable at all.
- [x] Confirm the **restore path** works end to end, not just that a backup
      file exists. An untested backup is a guess. Restore into a scratch
      `DATA_DIR` and study one card against it.
- [x] Decide a retention window (how far back can we roll a bad state?) and
      write it down — a corrupting write that gets faithfully backed up needs
      an older copy to escape to.
      - ✅ **DECIDED 2026-09-17: three layers, and the cron interval *is* the
        loss window** (`specs/STATE.md` **AD-027**, spec 022 D5/D6).
        `backup.yml` runs `0 */6 * * *`, so **a total Fly loss costs at most
        ~6 hours of reviews** — against measured volume (30 active days in 73,
        median 118 reviews per active day, max 263) that is a fraction of one
        session. Depth by layer: **git history** = deep rollback, unbounded,
        and the only layer that survives losing Fly; **Fly volume snapshots**
        = fast rollback, ≤ 5 days, **on-Fly only**; the **volume itself** is
        live state, not a backup. Two silent-failure modes are accepted and
        made visible rather than engineered away: GitHub auto-disabling the
        schedule after 60 days of repository inactivity (its email is the
        designated signal), and Fly token expiry.
- [x] Note the safety net that already exists: `revlog.ndjson` is append-only
      and holds every review ever answered, so a damaged `cards.json` is in
      principle rebuildable from it. Nothing does that today — worth a
      one-off repair tool if it ever proves cheap.
      - ⏭️ **DEFERRED 2026-09-17, not dropped** → `specs/BACKLOG.md`
        (2026-09-17 entry, "A `revlog.ndjson` → `cards.json` repair tool").
        This is spec `022-backup-and-restore`'s **O1**: it turned out not to
        be cheap. Replaying SM-2/FSRS over the whole review history is a
        scheduling-domain change, which `CLAUDE.md` classes as **at least
        Large on its own** — not a checkbox on a backup spec. The backlog
        entry records the wrinkles a future spec has to answer.
      - ⏭️ **Related, also deferred 2026-09-17** → `specs/BACKLOG.md`: the
        `/api/review` revlog-ahead-of-`cards.json` divergence in the
        Discovered list below. That is spec 022's **O2** — it is the
        *corruption* this repair tool would be asked to fix, so the two
        travel together. Deferred because it is a server-side durability bug
        on the persistence path, which 022's O5 puts out of scope.

## Phase 3 — Never lose a review in flight

The review loop optimistically updates local state and then POSTs
(`web/src/app/features/review/review.ts` › `rate()`, ~line 275). The POST is
awaited but **not retried** — on flaky cellular mid-session the card shows as
answered locally while the server never hears about it, and the review is
gone on reload. This is the highest-likelihood way to lose progress once the
phone is in play, and it is entirely a client-side fix.

- [x] Persist unsent reviews client-side (an outbox in `localStorage`/
      IndexedDB) so a failed or interrupted POST survives a reload, a tab
      kill, or a subway tunnel.
      — `localStorage` chosen over IndexedDB for its **synchronous** write
      (spec 023 D2/AD-029): `enqueue` persists before it returns. User-verified
      2026-09-18 by closing the tab offline and reopening; ops survived.
- [x] Retry the outbox with backoff and drain it on reconnect; `/api/review`
      needs to be safe to replay (same review applied twice must not corrupt
      state or double-append the revlog).
      — Backoff floor 2 000 ms, cap 60 s, sized against the tier-1 rate limiter
      (023 C-5). Replay-safety is server-side in `FileStore.appendRevlog`,
      pinned by `server/src/routes/review-idempotency.integration.test.ts`
      (3 cases): the route itself needed no change.
- [x] Surface unsent state in the UI. Silent loss is the failure mode that
      matters — the user must be able to see "3 reviews not yet saved" and
      know not to close the tab.
      — Shell banner in `app.html` (draining / will-retry / error + Retry
      button) plus a `beforeunload` guard; the study route refuses to start
      while ops are pending. User-verified 2026-09-18: the count climbed while
      offline and drained to zero on reconnect.
      **Amended 2026-10-11 (spec 023 Step 17):** the study-route refusal gate
      itself hung indefinitely on re-entry until two stacked defects were
      fixed — a `drain()` coalescing branch that bypassed its own scheduled
      backoff, and an unrelated `this`-binding crash in `getRetryDelay()` that
      silently rejected the awaited drain promise. User-verified end-to-end
      after both fixes: offline re-entry now reaches "N reviews not yet saved
      — reconnect to continue" and stays there correctly until reconnect, then
      recovers and serves an unanswered card.
- [x] Verify by doing it: airplane-mode mid-session, answer several cards,
      reconnect, confirm every review landed exactly once.
      — **DONE 2026-09-18** on the phone against `spanish-srs.fly.dev`
      (023 Step 14, criterion A8). **5 cards** answered in airplane mode; the
      live `revlog.ndjson` went **3923 → 3928**, exactly +5 with five distinct
      ids, and **no id appears more than once in any of the 3 928 live lines**.
      `schedBuried` 4 → 9; the deck's `daily` reset to `{day: 86,
      reviewStudied: 2}` — 2 and not 5 because `studiedKind()` returns `null`
      for the three relearn steps. Nothing was re-served after reconnecting.
      Ground truth is the live revlog pulled with `tools/pull-fly-state.sh`,
      not the phone's UI (L-025). The user reported "between 4-5"; the revlog
      settled it at 5, and 5 is the recorded count.
      **Caveat: TEXT cards only.** Audio is served by Express and there is no
      service worker, so a Listening card is unusable offline — see 023's
      amended A1 and the `specs/BACKLOG.md` entry for hiding audio-only cards
      offline.
      **Second caveat: the first attempt was blocked by a production rate-limit
      lockout** — the tier-1 limiter counts 401 auth challenges and sits before
      `basicAuth`, so a cold SPA load can spend the 20-failure budget and lock
      the phone out of the auth challenge itself. Cleared with
      `fly apps restart spanish-srs`. Pre-existing, but it compounds with the
      outbox's 60 s backoff cap; see 023's `## Discovered`.

## Phase 4 — Cross-device safety

The stated goal doesn't solve for simultaneous desktop+phone use, but
"progress is never lost" still applies to *sequential* use, which will
absolutely happen: the phone loads the collection into memory, the desktop
studies, then the phone posts. `POST /api/review` replaces the stored card
wholesale with the client's copy, with no version check — so the stale
device silently overwrites newer scheduling state. Detection is cheap;
silent loss is not acceptable.

**In planning 2026-10-11** — `specs/024-cross-device-safety/` (`Analyst.md` +
harden round 1 done; `tasks.md` awaits the human review of the one open
question, re-apply vs. warn-only). Two findings already change what this
section assumed:

- **`card.modified` cannot be the token.** Both schedulers return
  `{ ...card, modified: ctx.now }` — a *client* clock the server never sees, and
  the server stamps its own on write — so a naive `expectedModified` would
  false-conflict on every second review of a card in one session, i.e. on every
  learning step. The spec uses an explicit `card.rev` whose value is the
  `RevlogEntry.id` that produced the state: already client-minted, already
  unique, already the server's dedupe key.
- **A collection-level generation token is actively wrong here**, not just
  coarse: any desktop write would invalidate every queued phone op, so the
  normal *sequential* session — the actual use case — would reject constantly.

- [ ] Add a staleness precondition (per-card `rev`, **not** `modified` and
      **not** a collection-level generation token — see above) so a stale write
      is **rejected** rather than applied.
- [ ] Decide the client's response to a rejection — reload and re-apply, or
      warn the user. Either is fine; silently discarding is not.
- [ ] Consider a lightweight "this collection is open elsewhere" signal so
      the second device knows before a session, not after.

## Phase 5 — Mobile UI audit

Checked during this session — current state:

- Viewport meta tag is present and correct
  (`<meta name="viewport" content="width=device-width, initial-scale=1">`
  in `web/src/index.html`) — good baseline.
- **Zero `@media` queries anywhere** in the app (0 across all 7 component
  stylesheets under `web/src/app/features/`). Nothing has been deliberately
  adapted for narrow screens.
- Most containers use `max-width` (700px/960px/1000px) rather than fixed
  `width`, so layouts are fluid-ish below that cap — may work by accident
  more than by design.
- Two concrete risk spots found by inspection (not yet verified on a real
  phone):
  - `review.scss` (~line 258): the rating button row (Again/Hard/Good/Easy)
    is a fixed `grid-template-columns: repeat(4, 1fr)` with no narrow-screen
    fallback — likely cramped/hard to tap accurately on a phone.
  - `browser.scss` (~line 59): card-browser grid is
    `1fr 140px 110px 90px` — the fixed-px columns alone total 340px, which
    is tight-to-overflowing on a ~375px-wide phone screen.

- [ ] Once the server is reachable from a phone (Phase 1), do a real pass
      through deck-list, study/review, browse, stats, and options — either
      on-device or via Chrome mobile emulation — and note actual breakage,
      not just what looks risky by inspection.
- [ ] Fix per-component as needed. Likely its own Medium spec once the real
      breakage list exists (web/ only, no new pattern) — re-size if it turns
      out bigger.
- [ ] Mis-taps are a data-integrity issue here, not just a cosmetic one: a
      cramped rating row means wrong grades, and a wrong grade is a corrupted
      schedule that no backup will catch. Tap-target sizing counts as Phase 5
      acceptance, not polish.

## Discovered (append here as we find things)

- (2026-08-26) Mobile UI was never audited — added as Phase 5 above.
- (2026-08-26) `POST /api/import` is an unauthenticated whole-store rewrite
  (`replaceAll`) — harmless on localhost, catastrophic once deployed. Folded
  into Phase 0.
- (2026-08-26) A failed review POST is never retried, so a dropped connection
  loses the review silently — became Phase 3.
- (2026-08-26) `/api/review` has no staleness check, so a stale device
  overwrites newer scheduling state — became Phase 4.
- (2026-08-26) `FileStore.init()` treats an empty data dir as "seed a fresh
  collection", which makes a failed volume mount look like a working empty
  app rather than an error — folded into Phase 1.
- (2026-09-16) `data/spanish/*.json` + `revlog.ndjson` are git-tracked today,
  and git history is the current rollback mechanism for scheduling state.
  Once Fly writes to its own volume, that's a second live writer outside git
  — the rollback habit stops covering whatever happened on Fly unless a
  reconciliation step closes the loop. Folded into Phase 2 as a required
  decision (Fly-as-source-pulled-into-git vs. desktop-as-source-synced-to-Fly).
  **Resolved 2026-09-17: Fly-as-source** — see Phase 2 above and AD-025.
- (2026-09-17) **`/api/review` can leave the revlog ahead of `cards.json`** —
  Phase 2 input, promoted out of `021-fly-deploy` (C9) so it isn't lost in an
  archived spec. `routes/index.ts:116-123` calls `saveCardsSoon()` (debounced
  ~400ms) but `await store.appendRevlog(...)` (immediate). A **hard** kill
  inside that window — a crash or OOM, not a signalled stop — leaves the
  append-only revlog claiming a review that `cards.json` does not reflect.
  Not introduced by Phase 1, but **Fly's auto-stop makes it reachable for the
  first time**, and it is exactly the divergence Phase 2's "rebuild from
  revlog" note assumes is possible. Note the signalled path is fine and was
  verified in Step 20 (`flushAll()` on SIGINT/SIGTERM, clean exit 0) — this is
  only about kills that skip the handler.
  **Deferred 2026-09-17, not dropped** → `specs/BACKLOG.md` (2026-09-17 entry,
  "`/api/review` can leave `revlog.ndjson` ahead of `cards.json`"). Spec
  `022-backup-and-restore`'s **O2**: a server-side durability bug on the
  persistence path, which that spec's O5 puts out of scope, and a
  scheduling-domain change besides. Travels with O1 (the repair tool) above.
- (2026-09-17) **The tier-1 rate limiter covers all routes**, 20 failures per
  15 minutes (`app.ts:70-78`, `skipSuccessfulRequests: true`). An Angular page
  load 401s several times before credentials are entered, so two mistyped
  passwords plus a handful of missing-media 404s can lock the app out for 15
  minutes. Expect it rather than misdiagnosing it as an auth bug; a Phase 5
  mobile pass should budget for it.
- (2026-09-17) **Phase 5 input from the Phase 1 phone test.** A real cellular
  session on an iPhone found **no blocking UI problems** — the user's verdict
  was "good enough for now, come back to mobile UI in Phase 5". Two
  qualifications matter for whoever picks Phase 5 up:
  - The session ran against **already-fixed** layout. Two uncommitted mobile
    breakpoints (`web/src/app/app.scss` 768px — stack the shell instead of a
    fixed 280px side rail, cap `.tree-scroll` at 35vh; and
    `review.scss` 480px — tighten the card panel and rating grid) were written
    and deployed the same morning. So "good enough" describes the *patched*
    UI. Without them the sidebar's fixed width squeezed the review screen's
    rating row to an unusable sliver — which is precisely the mis-tap /
    data-integrity risk the Phase 5 bullet above calls acceptance, not polish.
  - **No systematic sweep was performed** — 12 cards, one device, one
    orientation, two of the five routes (`/`, `study/:deckId`). `browse`,
    `stats` and `options/:optionsId` have never been opened on a phone.
    "No blocking issues" is a deferral, not a clean bill of health.
