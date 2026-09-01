# Roadmap — remote/mobile access

Status: pre-spec — this is a living planning doc, not yet `Analyst.md` +
`tasks.md`. Per the [task sizing rule](../../CLAUDE.md#task-sizing-rule-sdd)
this initiative is **Large** (touches server, deploy infra, and the web
layer), so each phase below gets its own proper spec (`Analyst.md` +
`tasks.md` + harden pass) when we're ready to execute it — this doc is the
map, not the plan.

**Analysis re-run 2026-09-01** against the tree as it stands after specs 013
(server hardening) and 015–020 (lint rollout). Every claim below was
re-derived from the code rather than carried forward; where the 2026-08-26
pass was wrong or incomplete the correction is marked **[revised]** or
**[new]**, with the reasoning in the Discovered log. Phase 0 is closed.
Phase 5 grew a finding that changes the phase ordering.

## Goal

Be able to securely progress reviews from a phone when away from the desktop.
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
   to "what would it take to lose a review?" *better* than it was before.
   Losing scheduling state silently is the worst outcome in this project.

## Ordering rule **[revised]**

- Phase 0 must land before the server is publicly reachable. **It has.**
- **Phase 5a (app-shell layout) now blocks Phase 1's acceptance.** Phase 1's
  own success criterion is "a 200-card session round-trips from the phone",
  and the app shell is a fixed 280px sidebar in a flex row
  (`web/src/app/app.scss` › `.app-sidebar`), leaving ~95px of content on a
  375px screen. That session cannot be performed — so Phase 1 cannot be
  accepted — until the shell collapses on narrow screens. See Phase 5.
- Phases 2–4 must land before the phone is trusted for a *real* session —
  until then a phone session can silently drop or overwrite reviews.
- **Never fold Phase 4 into Phase 3's batch.** They look like one "make the
  review write robust" task and they are opposites: Phase 3 makes a write
  retry until it lands, Phase 4 makes a write *refuse* to land when it is
  stale. Shipping the retry without the precondition turns a dropped review
  into an automatically-replayed stale overwrite — strictly worse than today.
  If only one ships, it must be Phase 4.

## Phase 0 — Server hardening — **CLOSED**

Landed in `specs/archive/2026-08-27-013-server-hardening/`; see AD-011 …
AD-015 in `specs/STATE.md`. Re-verified against `server/src/app.ts`,
`server/src/config.ts` and `server/src/app.integration.test.ts` on 2026-09-01:

- [x] Serve the built Angular app from Express — `config.staticDir` plus the
      SPA-fallback middleware in `app.ts`.
- [x] Auth in front of everything — `basicAuth` is mounted before `/media`,
      `/api` and the static app. `GET /api/health` is the single deliberate
      exception (AD-015).
- [x] CORS. **[revised]** — resolved *differently* than the 2026-08-26 plan
      said. `cors()` is not locked to a deployed origin; it is **not mounted
      at all** when hardened (only under `DEV_MODE=1`, where :4200 and :3000
      genuinely are different origins). Serving the app and the API from one
      origin makes CORS unnecessary rather than restrictive. Better outcome —
      the checkbox's wording was stale, not the code.
- [x] Force HTTPS — `forceHttps` with `trust proxy` set for Fly's
      `X-Forwarded-Proto`, loopback exempt.
- [x] Contain `POST /api/import` — not *registered* when hardened
      (`buildRouter(store, { allowImport: !config.hardened })`), so it 404s
      rather than 403s (AD-014).
- [x] Body cap `50mb` → `2mb` (`BODY_LIMIT`, sized against the measured
      ~311KB resume payload — L-007), plus two `express-rate-limit` tiers
      (20/15min counting failures only; 5000/15min overall).
- [x] Security headers — `helmet` with an explicit CSP is mounted when
      hardened. **[revised: the 2026-08-26 doc still showed this unticked; it
      landed in 013.]**
- [x] Path traversal out of `/media` — covered by the
      `GET /media/%2e%2e%2fcards.json` test.
- [x] Unauthenticated `curl` verification — **automated**, not manual.
      `app.integration.test.ts` asserts 401 for `/api/collection`,
      `/api/review` and `/media/x.mp3`; 200 for `/api/health`; 404 for
      `/api/import`; and no CORS header for a foreign `Origin`.

**One genuinely open gap, carried into Phase 1 rather than reopening Phase 0:**

- [ ] The static-app mount and SPA fallback have **zero test coverage** —
      every case in `app.integration.test.ts` runs with `staticDir: null`,
      because the web app isn't built in the test environment. The mount sits
      after `basicAuth`, so it *should* 401, but "should, by inspection" is
      exactly the standard this phase exists to beat, and the roadmap's own
      wording was "the app root must fail". Cheapest fix: point `staticDir`
      at a temp dir holding a stub `index.html` and assert 401-without /
      200-with credentials on `/`, on a deep SPA route like `/study/abc`, and
      on a dotfile. Small — belongs in Phase 1's spec, because that is when
      the static mount first carries real traffic.

## Phase 1 — Deploy to Fly.io

Nothing exists yet: no `Dockerfile`, no `fly.toml`, no root `start` script.
`npm run build` produces `server/dist/` and `web/dist/web/browser/`;
`server/package.json`'s `start` is `node dist/index.js`.

- [ ] Dockerfile + `fly.toml`. **Preserve the two-workspace directory layout
      in the image** — `config.ts` resolves `staticDir` as
      `resolve(dirname(server/dist/index.js), '..', '..')` + `web/dist/web/browser`,
      so flattening the tree makes `staticDir` silently `null` and the server
      boots happily serving an API with no app in front of it.
- [ ] Persistent volume mounted over `data/spanish/` so scheduling state
      survives redeploys and restarts (`store/file-store.ts` writes here on
      every review).
- [ ] **Refuse to start on an unmounted/empty volume.** `FileStore.init()`
      passes a seed default to every `readJson` and then persists it when the
      file is absent, so a misconfigured mount does not error — it silently
      starts a blank app and writes that blank state to disk. A sentinel
      ("expected a populated store, found none → exit non-zero") turns the
      classic Fly data-loss story into a failed boot. Highest-value single
      item in this phase.
- [ ] **Ship the media. [new]** `data/spanish/media/` is 252MB and is
      **gitignored**, while `cards.json` / `notes.json` / `revlog.ndjson` are
      git-tracked. A naive deploy therefore produces a working-looking app in
      which every audio card's `<audio>` 404s — and the Listening note type's
      cards are *audio-only on the front*, i.e. unanswerable, not merely
      degraded. Decide the transfer mechanism (one-off `fly sftp`/`fly ssh`
      push to the volume, baking into the image, or object storage) and make
      it repeatable, since the converter regenerates media and a re-run has to
      be able to re-sync.
- [ ] **Decide what happens to the git-tracked copy of the store. [new]**
      Once Fly's volume is authoritative, the repo still holds a *diverging,
      older* `cards.json` + `revlog.ndjson`, and CLAUDE.md's own working
      agreement (L-002) tells the next session to run
      `git checkout -- data/spanish/` before any closing commit. That is now a
      command which restores stale scheduling state over newer state. Either
      stop tracking the canonical files (letting Phase 2's backup be the only
      copy), or write down explicitly that the tracked copy is a frozen seed
      and never a restore source. Leaving it undecided is how "progress is
      never lost" gets broken by someone correctly following the docs.
- [ ] Configure auto-stop/auto-start so the machine sleeps between sessions.
- [ ] **Confirm graceful stop actually flushes.** `saveCardsSoon()` debounces
      `cards.json` (~400ms) and only `flushAll()` on SIGINT/SIGTERM commits
      it. Note the sharper form of this: `POST /api/review` `await`s
      `appendRevlog` but only *schedules* the card write, so **the client
      receives its 200 before `cards.json` is durable**. A hard kill inside
      the debounce window loses card state the client believes was saved —
      which no amount of client-side retry (Phase 3) can detect. Verify the
      stop signal and grace period, and decide whether the review route should
      await the card write on a deployed instance.
- [ ] Automatic HTTPS on the `*.fly.dev` domain (free single-hostname cert).
- [ ] Verify: data survives a redeploy; a deliberately-broken mount refuses to
      boot; the phone reaches it over cellular, not just wifi; and a real
      session round-trips.

**Cost estimate** (Fly pricing checked 2026-08-26; data sizes re-measured
2026-09-01). shared-cpu-1x/256MB ≈ $2.02/mo if always-on, less with
auto-stop. Volume minimum is 1GB = $0.15/mo, and `data/spanish/` is **259MB**
— of which **252MB is `media/`** — so putting media on the volume costs
nothing extra at the minimum size, which is a point in its favour. The
scheduling state itself is small: `cards.json` 2.9MB, `notes.json` 2.2MB,
`revlog.ndjson` 0.7MB (~5.8MB total), growing by roughly one short line per
review. Bandwidth ($0.02/GB) and the cert are effectively free at this
volume. **Realistic total: ~$1–3/month.**

## Phase 2 — Backups and restore

`data/spanish/` is live state, not source. A Fly volume is a single copy on a
single host: it is not a backup.

- [ ] Decide a backup mechanism with at least one copy **off Fly**. Snapshots
      alone don't survive losing the account, or a bad write that gets
      faithfully snapshotted.
- [ ] Back up the *state*, not the media — `cards.json`, `notes.json`,
      `decks.json`, `collection.json`, `deckoptions.json`, `revlog.ndjson`
      (~5.8MB). Media is 252MB and regenerable from the converter; state is
      not regenerable at all.
- [ ] Confirm the **restore path** works end to end, not just that a backup
      file exists. An untested backup is a guess. Restore into a scratch
      `DATA_DIR` and study one card against it.
- [ ] Decide a retention window (how far back can we roll a bad state?) and
      write it down — a corrupting write that gets faithfully backed up needs
      an older copy to escape to.
- [ ] **Scope the revlog-replay repair tool here, rather than "if it ever
      proves cheap". [revised]** `revlog.ndjson` is append-only, is `await`ed
      on the request path (unlike `cards.json`), and `RevlogEntry` carries
      `cardId`, `reviewedAt`, `interval` and `factorOrStability` — so it is a
      real reconstruction source for a damaged or rolled-back `cards.json`.
      Nothing does that today. Given the Phase 1 finding above — the review
      response is sent before `cards.json` is durable — the revlog is not a
      nice-to-have net; it is the *only* record of reviews inside a lost
      debounce window.

## Phase 3 — Never lose a review in flight

Re-read `web/src/app/features/review/review.ts` › `rate()` (~line 263) on
2026-09-01. The 2026-08-26 description understated this in two ways.

**[revised] It is not one POST — it is three-plus writes, and they are not
atomic.** One rating performs, in order: `POST /api/review`; then
`recordStudied()` → `PATCH /api/decks/:id` (the daily tally); then
`burySiblings()` → one `PATCH /api/cards/:id` per sibling. A drop between them
leaves a review saved with its daily tally lost, or its siblings unburied.

**[revised] A failure does not merely lose the review silently on reload — it
stalls the session on a card that is already answered locally.** `rate()` is
`try { … } finally { busy.set(false) }` with **no `catch`**. On a rejected
POST, `store.applyCard(next)` and `queue.onAnswered()` have already run;
`recordStudied`, `burySiblings` and `loadNext()` are all skipped; the promise
rejects into a `void this.rate(...)` call site as an unhandled rejection; and
the UI sits on the same card showing no error. Re-rating it then double-counts
the answer.

- [ ] Persist unsent writes client-side (an outbox in `localStorage` /
      IndexedDB) so a failure survives a reload, a tab kill, or a tunnel —
      covering the whole rating transaction, not just `/api/review`.
- [ ] Retry with backoff and drain on reconnect. **Replay safety is a server
      change, not only a client one:** `POST /api/review` appends
      unconditionally, so a replayed review double-appends the revlog.
      `RevlogEntry.id` is already a client-generated id — dedupe on it.
- [ ] Give `rate()` a `catch`. Even before the outbox exists, a failed review
      must surface as an error and must not leave the queue
      advanced-but-unsent.
- [ ] Surface unsent state in the UI. Silent loss is the failure mode that
      matters — the user must be able to see "3 reviews not yet saved" and
      know not to close the tab.
- [ ] Verify by doing it: airplane-mode mid-session, answer several cards,
      reconnect, confirm every review landed exactly once and the daily tally
      matches.

## Phase 4 — Cross-device safety

The stated goal doesn't solve for simultaneous desktop+phone use, but
"progress is never lost" still applies to *sequential* use, which will
absolutely happen. `POST /api/review` (`server/src/routes/index.ts` ~line 115)
does `cards[idx] = { ...card, modified: Date.now() }` — it replaces the stored
card wholesale with the client's copy and stamps its *own* `modified`, with no
version check. A phone that loaded the collection an hour ago silently
overwrites everything the desktop did since. Detection is cheap; silent loss
is not acceptable.

- [ ] Add a staleness precondition so a stale write is **rejected**, not
      applied. **The pattern already exists in this codebase:**
      `POST /api/collection/resume` takes `expectedPausedAt` and refuses when
      it doesn't match (AD-005; `api.service.ts` › `resume()`). Mirror it — an
      `expectedModified` on the review payload is the smallest version of
      this, since `Card.modified` is already server-stamped on every write.
- [ ] Cover the other write paths too, or say explicitly why not:
      `PATCH /api/cards/:id` (bury, suspend, unsuspend) and
      `PATCH /api/decks/:id` (daily tally) have the same last-writer-wins
      shape.
- [ ] Decide the client's response to a rejection — reload and re-apply, or
      warn the user. Either is fine; silently discarding is not. This
      interacts with Phase 3: a rejected write must *leave* the outbox, not
      retry forever.
- [ ] Consider a lightweight "this collection is open elsewhere" signal, so
      the second device knows before a session rather than after.

## Phase 5 — Mobile UI

Re-audited 2026-09-01. Still **zero `@media` queries** anywhere in `web/src`
(verified: 0 matches across every stylesheet and template), and the viewport
meta tag in `web/src/index.html` is present and correct. Two items from the
2026-08-26 pass survive unchanged, one was wrong, and one new item outranks
everything that was listed.

### 5a — App shell (blocking; see Ordering rule) **[new]**

- [ ] `web/src/app/app.scss` › `.app-sidebar` is
      `flex: 0 0 280px; width: 280px; position: sticky; height: 100vh` inside
      `.app-shell { display: flex }`. On a 375px-wide phone that leaves ~95px
      for the entire app. This is not "cramped", it is unusable, and it
      applies to *every* route — so it invalidates any device testing of
      Phases 1–4 until it is fixed. Needs a narrow-screen breakpoint that
      stacks or collapses the sidebar. Being the first `@media` query in the
      codebase, it also sets the breakpoint convention the rest of 5b will
      follow — worth deciding deliberately rather than inheriting from
      whichever component happens to get fixed first.

### 5b — Per-page passes (after 5a, on a real device)

- [ ] `review.scss` (~line 258): `.ratings` is
      `grid-template-columns: repeat(4, 1fr)` with no narrow-screen fallback.
      **Still current.** Mis-taps here are a data-integrity issue, not a
      cosmetic one: a wrong grade is a corrupted schedule that no backup will
      catch. Tap-target sizing counts as acceptance, not polish.
- [ ] Two more 4-column grids the 2026-08-26 pass missed —
      `deck-list.scss:101` and `stats.scss:21` — plus `stats.scss:139`
      (`64px 1fr 48px`).
- [ ] `browser.scss` (~line 59): card-browser grid is `1fr 140px 110px 90px`;
      the fixed-px columns alone total 340px. **Still current.**
- [ ] **Audio autoplay on mobile. [new]** `review.ts` (~line 116)
      programmatically calls `el.play()` to chain a Listening card's
      audio-only front, and swallows the rejection with
      `.catch(() => undefined)`. Mobile browsers restrict programmatic
      playback without a user gesture; whether the rating tap's gesture still
      counts after the intervening `await` needs **device verification, not
      inspection**. What is certain from the code is that if it *is* blocked
      it fails silently — an audio-only card that never plays and shows no
      error is an unanswerable card, leaving the user to guess a grade or
      abandon the session. Verify first; if blocked, an explicit play
      affordance is the fix.
- [ ] **Checked and cleared — not a problem. [revised]** The stats heatmap's
      fixed 11px cells sit inside `.heatmap-wrap { overflow-x: auto }`
      (`heatmap.scss:1`), so it scrolls rather than overflowing. Recorded so
      nobody re-flags it.
- [ ] Real pass through deck-list, study/review, browse, stats and options —
      on device or via Chrome mobile emulation — noting actual breakage, not
      what looks risky by inspection. Fix per-component from that list. Likely
      its own Medium spec once the real list exists.

## Open question — is a public deploy the right shape at all? **[new]**

Worth settling before Phase 1's spec, because it changes what Phase 1 *is*.
The roadmap has treated "reachable from the public internet, behind auth" as
the only option since 2026-08-26. It isn't. A private overlay network
(Tailscale/WireGuard, phone and host on one tailnet) makes the server
reachable from the phone without it ever being reachable by anyone else —
which strictly dominates public-but-authenticated against non-negotiable #1,
and removes the open Phase 0 gap, the credential brute-force surface, and the
TLS requirement in one move. It could also run on this machine, deleting
Phase 1's volume, media-transfer and unmounted-boot problems entirely — at
the cost of requiring the desktop to be awake, which cuts against the whole
point of "away from the desktop" and is the main argument for Fly.

This is not a recommendation to abandon Fly; Phase 0's hardening is correct
either way and is not wasted. It is a recommendation that "we chose a public
deploy" become a written decision with its reasoning — an `AD-NNN` in
`specs/STATE.md` — rather than an unexamined default.

## Discovered (append here as we find things)

- (2026-08-26) Mobile UI was never audited — added as Phase 5 above.
- (2026-08-26) `POST /api/import` is an unauthenticated whole-store rewrite
  (`replaceAll`) — harmless on localhost, catastrophic once deployed. Folded
  into Phase 0. **Closed in 013 (AD-014).**
- (2026-08-26) A failed review POST is never retried, so a dropped connection
  loses the review silently — became Phase 3.
- (2026-08-26) `/api/review` has no staleness check, so a stale device
  overwrites newer scheduling state — became Phase 4.
- (2026-08-26) `FileStore.init()` treats an empty data dir as "seed a fresh
  collection", which makes a failed volume mount look like a working empty
  app rather than an error — folded into Phase 1.
- (2026-09-01) **The app shell is a fixed 280px sidebar.** Missed entirely by
  the first Phase 5 audit, which read the feature stylesheets and not
  `app.scss`. It outranks every other mobile item and it blocks Phase 1's own
  acceptance criterion — hence the Ordering-rule change and the 5a/5b split.
- (2026-09-01) **One rating is three-plus non-atomic HTTP writes**, and
  `rate()` has no `catch`, so a failure stalls the session on a
  locally-answered card rather than merely losing it on reload. Phase 3's
  scope is larger than "retry the review POST".
- (2026-09-01) **`POST /api/review` returns 200 before `cards.json` is
  durable** — the revlog append is awaited, the card write is only debounced.
  No client-side retry can detect this class of loss, which is why Phase 2's
  revlog-replay tool moved from "if it ever proves cheap" to scoped work.
- (2026-09-01) **`data/spanish/media/` is gitignored but the canonical JSON is
  git-tracked.** Two consequences: media needs its own transfer story in
  Phase 1 (audio-only Listening cards are unanswerable without it), and after
  deploy the repo holds a stale fork of the live store that L-002's own
  `git checkout -- data/spanish/` instruction would restore over it.
- (2026-09-01) **Phase 0's CORS item resolved differently than planned** — not
  mounted at all when hardened, rather than origin-locked. Better outcome; the
  checkbox text was stale. Helmet had likewise already landed in 013 while the
  roadmap still showed it unticked — the general hazard of a living doc that
  no push gate touches.
- (2026-09-01) **The static-app mount has no test coverage** — every
  `app.integration.test.ts` case runs `staticDir: null`. The one real Phase 0
  gap; carried into Phase 1 rather than reopening the phase.
- (2026-09-01) **Listening-card autoplay may be blocked on mobile and fails
  silently** (`.catch(() => undefined)`). Needs device verification before it
  is treated as either a bug or a non-issue.
- (2026-09-01) **Cleared, not a problem:** the stats heatmap's fixed-px cells
  are inside an `overflow-x: auto` wrapper. Recorded so it isn't re-flagged.
- (2026-09-01) **The public-vs-private-network choice was never actually
  made.** See the Open question section.
