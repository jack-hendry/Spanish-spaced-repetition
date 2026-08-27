# Analyst — server hardening (Phase 0 of remote/mobile access)

Parent roadmap: [`specs/011-mobile-remote-access/ROADMAP.md`](../011-mobile-remote-access/ROADMAP.md) § Phase 0.
Size: **Large** (server + build/deploy config + a new dependency surface;
CLAUDE.md sizing rule → full spec + 2 harden rounds + post-code review).

## 1. What problem are we solving?

`server/src/index.ts` is a localhost-only dev server that is about to be put
on the public internet (Phase 1, Fly.io). As it stands today it has:

- **No authentication of any kind.** Every route in `routes/index.ts` is open,
  including every write.
- **`app.use(cors())`** — the fully-permissive default, reflecting any origin.
- **No production static serving.** Only `web/proxy.conf.json` splits API
  (:3000) from the Angular dev server (:4200), so there is no single process
  that serves both.
- **`POST /api/import`** (`routes/index.ts:218`) calls `runImport` →
  `store.replaceAll(...)` (`file-store.ts:213`), which rewrites
  `collection/notetypes/decks/deckoptions/notes/cards` wholesale from whatever
  is in `_source/`. One unauthenticated POST destroys all scheduling state.
- **`express.json({ limit: '50mb' })`** — a 50MB unauthenticated body is a free
  memory/disk exhaustion primitive.
- **No security headers**, no HTTPS enforcement, no rate limiting.

The roadmap's non-negotiable #1 is that nothing is reachable without
authentication — API, app and media alike. Non-negotiable #2 is that progress
is never lost, and the import endpoint is the single fastest way to lose all of
it. This spec closes both before anything is deployed.

## 2. What is in scope?

### 2.1 Serve the built app from Express

One process answers `/api`, `/media` and the app itself. Angular's build output
is `web/dist/web/browser/` (project name `web`, Angular 17+ `browser/`
subfolder). Express serves that directory with an SPA fallback so client-side
routes (`/study/:deckId`, `/browse`, `/stats`, `/options/:id`) survive a
hard reload — a phone *will* reload mid-session.

The dev workflow does not change: `npm run dev` keeps the two-server proxy
setup, and static serving is active only when the built output exists (or is
explicitly enabled). Dev must not require a build.

### 2.2 Authentication in front of everything

HTTP Basic, single credential pair from env (`AUTH_USER`, `AUTH_PASSWORD`),
never committed. Rationale for Basic over a signed session cookie:

- The data layer has no user model at all — genuinely single-user. A session
  table would be inventing a concept the app does not have.
- Zero web-layer changes. A cookie session needs a login page, a logout
  affordance, and an Angular auth interceptor — that is a second feature, and
  it would drag `web/` into a spec that is otherwise server-only.
- The browser attaches Basic credentials automatically to same-origin
  subresources after the first prompt, so `/api/*` `fetch()` calls and
  `/media/*` audio tags authenticate with no client code whatsoever.

Accepted cost: no logout, and credentials are re-sent on every request. Both
are acceptable **only** over HTTPS, which §2.4 enforces. If the phone
experience proves annoying (re-prompting on every cold start), a signed
session cookie is a follow-up spec, not a reason to delay Phase 0.

Comparison must be constant-time. Because `timingSafeEqual` throws on
length-mismatched buffers — and the length itself leaks — both the supplied and
expected values are SHA-256 hashed first, then compared as equal-length digests.

**One deliberate exception: `GET /api/health` stays unauthenticated.** Fly's
HTTP health checks cannot present credentials, and a check that 401s marks the
machine unhealthy forever. The endpoint returns exactly `{ ok: true }` and must
never be extended to report store contents, counts, versions or paths. This
exception is the one hole in "auth in front of everything" and is documented as
such.

### 2.3 Middleware order (load-bearing)

```
trust proxy → HTTPS redirect → helmet → rate limit → auth → express.json → routes
```

The placement of `express.json` **after** auth is the point: an unauthenticated
request never has its body parsed at all, so the body-size limit stops being an
anonymous memory-exhaustion primitive. That is what makes §2.5's limit a
tuning decision rather than a security control.

### 2.4 HTTPS enforcement

Fly terminates TLS and forwards `X-Forwarded-Proto`, so `app.set('trust proxy', 1)`
is required or `req.protocol` is always `http` and the redirect loops forever.
Redirect (or refuse) plain HTTP, plus HSTS via helmet. Enforcement is skipped
when not in production so local `http://localhost:3000` still works.

### 2.5 CORS lockdown and body cap

- **CORS:** once Express serves the app, production is same-origin and needs no
  CORS middleware at all. `cors()` is applied only in dev (or to an explicit
  `ALLOWED_ORIGIN` if one is ever set). Removing it entirely in production is
  stricter than allow-listing an origin, and costs nothing.
- **Body cap:** measured, not guessed. `POST /api/collection/resume` sends
  `{id, due}` for every card — **~311 KB at today's 7,276 cards** — which is by
  far the largest real payload (`/api/review` is one card + one revlog entry,
  well under 10 KB). A 100 KB cap would silently break pause/resume. Cap is
  **2 MB**: ~6x headroom over today's resume payload, and harmless behind auth
  per §2.3.

### 2.6 Contain `POST /api/import`

Not gated — **not registered at all** when running in production. `replaceAll`
against a `_source/` directory that may not even be on the Fly volume is a
whole-store wipe with no undo, and there is no legitimate reason to run the
importer against the deployed instance: imports happen on the desktop, against
the desktop's data dir. A route that does not exist cannot be reached by a
mistake, a bug, or a leaked credential. It returns 404 (indistinguishable from
any other unknown path — no advertising that a gated admin route exists).

### 2.7 Rate limiting and security headers

- `express-rate-limit` in front of auth, so credential guessing is bounded.
  It requires `trust proxy` to be set correctly or every request appears to
  come from the Fly edge and one client rate-limits everyone.
- `helmet` for security headers. **CSP is the risk spot:** note-type CSS and
  rendered card templates go through `bypassSecurityTrustHtml`, and Angular's
  runtime injects styles. CSP must be configured and then *verified by loading
  the real app and studying a card*, not assumed.
- One CSP conflict is already known and confirmed by the critic pass (R2):
  Angular's production build inlines critical CSS and emits
  `<link rel="stylesheet" … onload="this.media='all'">`. That `onload` is an
  inline event handler, which `script-src 'self'` blocks — leaving the
  stylesheet at `media="print"` and the app unstyled, while every status-code
  check still passes. Fixed by disabling critical-CSS inlining
  (`inlineCritical: false`) rather than by weakening `script-src`.
  `style-src 'unsafe-inline'` is still required and stays.

### 2.8 Verification by trying

Unauthenticated `curl` against `/api/collection`, `/api/review`, `/media/<file>`
and the app root must all fail with 401. This is an acceptance criterion with
literal commands, not a checkbox.

## 3. What is OUT of scope?

Explicitly **not** in this spec:

- **Dockerfile, `fly.toml`, volumes, deployment.** All Phase 1. This spec must
  leave the server *ready* to deploy and deploys nothing.
- **The empty-volume sentinel check** (`FileStore.init()` seeding a blank
  collection over a failed mount). It is listed under Phase 1 in the roadmap
  and belongs with the volume config that gives it meaning.
- **Backups / restore** — Phase 2.
- **The client-side review outbox and retry** — Phase 3.
- **Staleness / version checks on `POST /api/review`** — Phase 4. This spec
  does not touch review semantics at all.
- **Mobile UI / responsive fixes** — Phase 5.
- **A login page, logout, session cookies, or any Angular auth interceptor.**
  Basic auth is chosen precisely so `web/` needs no *application* changes; if a
  step finds itself editing `web/src/app/`, the spec has drifted.
  **Narrow exception (added by critic R2):** `web/angular.json`'s **build
  configuration** is in scope, solely to disable critical-CSS inlining so the
  build stops emitting an inline `onload` handler that CSP must otherwise
  permit. `web/src/` remains fully out of scope. Shipping a CSP that breaks the
  app's styling is not an acceptable way to keep this boundary.
- **Any user model, multi-user support, or credential storage in the data
  store.** Credentials are env vars, full stop.
- **Password hashing at rest** (argon2/scrypt of a stored hash). The expected
  password is a platform secret, not a database row; hashing it protects
  against a threat model (leaked env dump) that already implies total
  compromise of the machine holding the data.
- **HTTPS certificate management** — Fly provides it (Phase 1).

## 4. How do we know it is done?

Acceptance criteria, each checkable:

**A1 — Nothing is reachable unauthenticated.** With the server hardened, all of
these return `401`:
```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3999/api/collection
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3999/api/review
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3999/media/<a-real-file>
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3999/
# `..` must NOT be normalised away by curl, or the check is vacuous (critic R6):
curl -s --path-as-is -o /dev/null -w '%{http_code}\n' http://localhost:3999/api/health/../collection
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3999/media/%2e%2e%2fcards.json
```
and the same requests with `-u "$AUTH_USER:$AUTH_PASSWORD"` return `200` (the
two traversal probes excepted — those must never return `200` with store
contents under any credentials; see A9).

**A2 — `GET /api/health` is the only anonymous route**, returns exactly
`{"ok":true}`, and a grep of the health handler shows it reads nothing from
the store.

**A3 — A wrong password fails.** `curl -u 'user:wrong'` → `401`, and
`curl -u 'wrong:pass'` → `401`. Covered by an automated test, not only by hand.

**A4 — `POST /api/import` returns 404 in production** and still works in dev.

**A5 — The built app is served and survives a reload on a client-side route.**
`GET /study/<real-deck-id>` (authenticated) returns the app's `index.html`
with `200`, not a 404.

**A6 — Pause/resume still works.** The ~311 KB resume payload is accepted, not
rejected by the body cap. Pinned by an automated test that posts a resume
payload of realistic size.

**A7 — The real app works end to end behind the hardened server.** Build,
run hardened, log in, open a deck, **study and rate a card**, confirm the
review persists, and confirm card audio plays (that last one is what catches a
CSP that blocks `/media`). Not a curl check — the actual app. The page must
render **styled**; an unstyled page means CSP blocked the stylesheet (§2.7).

This runs against a **scratch `DATA_DIR`**, never the live store (critic R3):
verification must not be able to damage the scheduling state this spec exists
to protect. Copy the JSON state and symlink `media/`.

**A8 — CORS is absent in production.** A cross-origin request carries no
`Access-Control-Allow-Origin` in the response.

**A9 — Nothing outside `data/spanish/media/` is reachable** through the static
mounts — in particular `cards.json` / `notes.json` / `revlog.ndjson` are not
served by any path.

**A10 — The suite is green and the tree is clean.** `npm run test` passes both
workspaces (server goes from **39** today to **71**), `npm run build` succeeds,
and `git status` is clean after — `data/spanish/` must not be dirtied by any
verification run (L-002). Because every verification step uses a scratch
`DATA_DIR` (A7), "clean" is an absolute requirement here, not an
expected-dirty exception.

## 5. Decisions (resolved with the human, 2026-08-26)

**D1 — HTTP Basic, as proposed in §2.2.** Server-only; `web/` stays untouched.
A signed session cookie remains a possible follow-up *after* the phone has
actually been used in anger — real annoyance, not predicted annoyance.

**D2 — Fail safe: hardened by default, `DEV_MODE=1` opts out.** Supersedes the
`NODE_ENV=production` proposal. Everywhere §2 says "in production", read
"unless `DEV_MODE=1`". A forgotten environment variable therefore yields the
*secure* behaviour; the insecure mode requires someone to have asked for it.

Consequences, all of which the tasks must handle:
- `npm run dev -w server` sets `DEV_MODE=1` explicitly.
- The hardened path is what runs by default, so **the default is what gets
  tested** — the reverse of the usual arrangement, and the reason this was
  chosen.
- Existing integration tests (`notes.integration.test.ts`,
  `resume.integration.test.ts`) assemble their own bare Express app around
  `buildRouter(store)` and never touch the hardened stack, so they are
  unaffected. New auth coverage tests the hardened app factory directly.

**D3 — Refuse to start without credentials.** If `AUTH_USER` / `AUTH_PASSWORD`
are unset while hardened, the server logs a clear error and exits non-zero. It
must never serve unauthenticated, and must never generate a random password
nobody knows — a machine that boots "successfully" into an unreachable or open
state is the failure this whole spec exists to prevent. (Same shape as the
Phase 1 empty-volume sentinel: a misconfiguration should be a failed boot, not
a silently wrong one.)

**D4 — Extract a `createApp(store, config)` factory** (`server/src/app.ts`) so
the hardened middleware stack is testable without spawning a process;
`index.ts` becomes a thin bootstrap that reads env, validates it per D3, and
listens. Without this, auth is only testable end-to-end and A3 turns into a
manual check.

## Discovered

- (2026-08-26) `POST /api/collection/resume` sends every card's `{id, due}` —
  ~311 KB today and growing linearly with the collection. Any body cap below
  ~1 MB silently breaks pause/resume, and the failure mode is a 413 mid-resume
  with `pausedAt` still set. Folded into §2.5.
- (2026-08-26) Fly HTTP health checks cannot authenticate, forcing a documented
  anonymous exception at `/api/health` (§2.2). Worth re-checking at Phase 1
  whether a TCP check would let us close even that hole.

## Retrospective

(2026-08-27, after executing all 15 steps)

### Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| A1 | Nothing reachable unauthenticated | **PASS** | Step 12 curl matrix against `node server/dist/index.js`: `/`, `/api/collection`, `POST /api/review`, `/media/$MEDIA` all `401`; `--path-as-is /api/health/../collection` → `401` (not normalised). Also pinned by tests 1/3/8 in `app.integration.test.ts`. |
| A2 | `/api/health` is the only anonymous route, body exactly `{"ok":true}` | **PASS** | Step 12 (body byte-compared); test 4 deep-equals `{ ok: true }`. Handler reads nothing from the store — `app.ts:37` is a literal. |
| A3 | Wrong password / wrong user fail | **PASS** | Tests 5 and 6 (`u:wrong` → 401, `wrong:p` → 401), automated, not by hand. |
| A4 | `POST /api/import` 404s hardened, works in dev | **PASS** | Step 12 authenticated `POST /api/import` → `404`; test 7 (hardened → 404) and test 14 (dev → not 404). |
| A5 | Built app served, survives reload on a client-side route | **PASS** | Step 12 authenticated `GET /study/somedeckid` → `200` containing `<app-root`; confirmed again in a real browser reload during A7. |
| A6 | Pause/resume payload accepted | **PASS** | Test 12 posts 8,000 `{id,due}` entries (~320 KB, above today's ~311 KB) → not 413. |
| A7 | Real app works end to end, styled, audio plays, review persists | **PASS (verified by hand)** | Could **not** be driven by browser automation — see "What went wrong" below. Verified manually against the scratch `DATA_DIR` server on :3999: deck list and revealed card render styled, no CSP console violations, audio plays, rating persisted across a reload on `/study/:deckId`. |
| A8 | No CORS in production | **PASS** | Test 11 (`Origin: https://evil.example` → no `access-control-allow-origin` when hardened); test 15 confirms it *is* present in dev, so the assertion is not vacuous. |
| A9 | Nothing outside `media/` reachable via static mounts | **PASS** | Test 10 and Step 12: `/media/%2e%2e%2fcards.json` → `404`, body carries no card JSON. |
| A10 | Suite green, tree clean | **PASS** | `npm run test` green both workspaces, server **39 → 71** exactly as planned; `npm run build` exits 0; `data/spanish/` clean after every step, including the two browser runs and the manual A7 pass. |

### Did Analyst.md catch anything not thought about up front?

Yes, and the two that mattered both came out of the critic rounds rather than
the first draft. **R2** (CSP vs Angular's inline `onload`) would have shipped an
unstyled app that passed every status check — it became Step 7 and is now
**L-008**. The measured resume payload (~311 KB) turned a "sensible" 100 KB body
cap into a silent pause/resume breakage — now **L-007**. Both are cases where
the plan was wrong in a way that no test *in the plan as written* would have
caught, which is the specific thing the harden rounds are for.

### Did anything in tasks.md turn out to be wrong during coding?

Three things, none design errors:

1. **Step 3's `grep -c "timingSafeEqual" → 1` check was simply wrong.** The code
   that same step dictates contains the token three times (import, JSDoc,
   call site). The executor reported the mismatch instead of "fixing" the code
   to satisfy the grep, which is the right call — but a "Done when" that the
   step's own code cannot satisfy is a defect in the step. Lesson for future
   task-writing: if a check counts occurrences, count them in the literal block
   being pasted.
2. **Step 13 was undeliverable as written.** It assumes a browser can be driven
   through HTTP Basic Auth. It cannot: Chrome's native auth dialog is not
   answerable by the automation (a `user:pass@host` URL is rejected outright,
   and priming the credential cache with an `Authorization`-header `fetch()`
   returns 200 but does not populate Chrome's HTTP-auth cache — the next
   top-level navigation still challenges and auto-fails to
   `chrome-error://chromewebdata/`). Two independent techniques were tried and
   both failed for the same root reason, so the criterion was met by a human
   instead. **Any future spec with a browser-verified criterion behind Basic
   auth should plan for manual verification**, or the phone/session-cookie
   follow-up (D1) changes this.
3. **A wrong diagnosis of the delegation hook, caught by a sibling session.**
   First read: "the hook blocks all top-level writes while the marker is
   active, spec docs included." Wrong — `enforce-haiku-tasks-pretooluse.sh`
   exempts `.md` unconditionally in its non-Bash branch, proven by `Edit` calls
   on `CLAUDE.md` and root `STATE.md` both succeeding with the marker still
   active. What actually blocked was the **Bash branch**, on both occasions a
   heredoc (`cat > … <<'EOF'`, `python3 - <<'PY'`): that branch tests the
   *command text* for a protected path, not the resolved target, and a
   retrospective naturally quotes `server/src/...` paths in its own prose. The
   real lesson: **write spec docs with `Write`/`Edit`, not shell heredocs** —
   exactly what the hook's comments say it defends against. "Remove the marker
   first" unblocks it too, but by disarming the guard, not complying with it.

### Discovered during execution

- **The hardened server did not always exit on SIGINT.** In both browser-driven
  runs it stopped listening promptly but the process lingered until
  force-killed; in a manual run with no browser attached it exited cleanly in
  2s. Points at a live keep-alive connection holding the event loop open, not
  a fault in `flushAll` — **not proven**, but matters directly to Phase 1's
  "confirm graceful stop actually flushes" checkbox. Worth a deliberate look
  when Phase 1 configures auto-stop.
