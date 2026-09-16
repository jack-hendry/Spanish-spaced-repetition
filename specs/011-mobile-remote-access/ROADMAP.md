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

- [ ] Dockerfile + `fly.toml`.
- [ ] Persistent volume mounted over `data/spanish/` so scheduling state
      survives redeploys/restarts (server writes here on every review —
      `store/file-store.ts`).
- [ ] **Refuse to start on an unmounted/empty volume.** `FileStore.init()`
      seeds a fresh empty collection when the data dir is empty, so a
      misconfigured mount doesn't error — it silently starts a blank app and
      then persists that blank state. A sentinel check ("expected a populated
      store, found none → exit non-zero") turns the classic Fly data-loss
      story into a failed boot.
- [ ] Configure auto-stop/auto-start so the machine sleeps between sessions
      — usage will be occasional, not continuous.
- [ ] **Confirm graceful stop actually flushes.** `cards.json` writes are
      debounced (~400ms) and only `flushAll()` on SIGINT/SIGTERM saves them;
      an auto-stop that hard-kills the machine loses the last few reviews.
      Verify the stop signal and grace period are long enough for the flush.
- [ ] Automatic HTTPS on the `*.fly.dev` domain (free single-hostname cert,
      first 10 per org are free).
- [ ] Verify: data survives a redeploy, phone can reach it over cellular
      (not just wifi), a 200-card session round-trips correctly.

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

- [ ] Decide a backup mechanism, with at least one copy **off Fly** (periodic
      pull to this machine, a small cron job pushing elsewhere, Fly volume
      snapshots as a convenience layer — first 10GB/mo free per the pricing
      page). Snapshots alone don't survive losing the account or a bad write
      that gets snapshotted.
- [ ] Back up the *state*, not the media — `cards.json`, `notes.json`,
      `decks.json`, `collection.json`, `deckoptions.json`, `revlog.ndjson`.
      Media is 250MB and regenerable from the converter; state is 5MB and is
      not regenerable at all.
- [ ] Confirm the **restore path** works end to end, not just that a backup
      file exists. An untested backup is a guess. Restore into a scratch
      `DATA_DIR` and study one card against it.
- [ ] Decide a retention window (how far back can we roll a bad state?) and
      write it down — a corrupting write that gets faithfully backed up needs
      an older copy to escape to.
- [ ] Note the safety net that already exists: `revlog.ndjson` is append-only
      and holds every review ever answered, so a damaged `cards.json` is in
      principle rebuildable from it. Nothing does that today — worth a
      one-off repair tool if it ever proves cheap.

## Phase 3 — Never lose a review in flight

The review loop optimistically updates local state and then POSTs
(`web/src/app/features/review/review.ts` › `rate()`, ~line 275). The POST is
awaited but **not retried** — on flaky cellular mid-session the card shows as
answered locally while the server never hears about it, and the review is
gone on reload. This is the highest-likelihood way to lose progress once the
phone is in play, and it is entirely a client-side fix.

- [ ] Persist unsent reviews client-side (an outbox in `localStorage`/
      IndexedDB) so a failed or interrupted POST survives a reload, a tab
      kill, or a subway tunnel.
- [ ] Retry the outbox with backoff and drain it on reconnect; `/api/review`
      needs to be safe to replay (same review applied twice must not corrupt
      state or double-append the revlog).
- [ ] Surface unsent state in the UI. Silent loss is the failure mode that
      matters — the user must be able to see "3 reviews not yet saved" and
      know not to close the tab.
- [ ] Verify by doing it: airplane-mode mid-session, answer several cards,
      reconnect, confirm every review landed exactly once.

## Phase 4 — Cross-device safety

The stated goal doesn't solve for simultaneous desktop+phone use, but
"progress is never lost" still applies to *sequential* use, which will
absolutely happen: the phone loads the collection into memory, the desktop
studies, then the phone posts. `POST /api/review` replaces the stored card
wholesale with the client's copy, with no version check — so the stale
device silently overwrites newer scheduling state. Detection is cheap;
silent loss is not acceptable.

- [ ] Add a staleness precondition (per-card `modified`, or a
      collection-level generation token) so a stale write is **rejected**
      rather than applied.
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
