# tasks — 013 server hardening

**Archived summary.** All 15 steps executed and verified 2026-08-27; server
tests went 39 → 47 → 56 → 71 as planned. This file originally carried full
inline source for every created file plus verbose Do/Context/Done-when/
If-blocked sections per step — condensed here at archive time (CLAUDE.md
end-of-feature ritual) since the code now lives in the real source files and
the reasoning behind each decision is recorded in `Analyst.md` (scope, D1–D4,
retrospective) and `specs/STATE.md` (AD-011..AD-015, L-007, L-008). See
`CriticReview.md` for the two harden rounds' 13 findings.

Governing rules, unchanged throughout: **D2** — hardened is the default,
`DEV_MODE=1` opts out, no `NODE_ENV` branch anywhere. **D3** — a hardened
server with no credentials refuses to boot. **Verification never touches the
live store** — every step ran against a scratch `DATA_DIR`; `data/spanish/`
stayed clean after all 15.

---

### Step 1 — Add `helmet` and `express-rate-limit` dependencies
**Model:** haiku · **Status:** done (`helmet@^8`/`express-rate-limit@^8` installed — 39 tests green)
Pinned to majors verified against the installed versions (CriticReview R1).

### Step 2 — Create `server/src/config.ts` (env parsing, fail-safe, refuse-to-start)
**Model:** haiku · **Status:** done (`server/src/config.ts` + `config.test.ts` — 47 tests)
`loadConfig(env)` derives `ServerConfig` (hardened, port, authUser/Password,
staticDir, bodyLimit) from a passed-in env object, never mutating
`process.env`. Throws `ConfigError` when hardened with no credentials (D3). 8
tests, no `NODE_ENV` reference.

### Step 3 — Create the Basic-auth middleware with constant-time comparison
**Model:** haiku · **Status:** done (`server/src/middleware/auth.ts` + `auth.test.ts` — 56 tests)
`basicAuth(user, password)`: both sides SHA-256 hashed to fixed 32 bytes
before `timingSafeEqual` (which throws on length mismatch otherwise), both
comparisons always computed (no `&&` short-circuit between them). 9 tests,
including a password containing a colon (pins `indexOf(':')` over a naive
`split`).

### Step 4 — Create `server/src/app.ts`: the ordered hardened middleware stack
**Model:** haiku · **Status:** done (`app.ts` middleware order grep-verified: `basicAuth` L83 < `express.json` L90 < `/api` L96)
`createApp(store, config)`. Order (load-bearing, see AD-013): `GET /api/health`
first and anonymous → if hardened: `forceHttps` (loopback-exempt) → `helmet`
(CSP) → two `express-rate-limit` tiers → `basicAuth`; else `cors()` (dev only)
→ `express.json` (after auth, so an unauthenticated request never gets a body
parsed) → `/media` static → `/api` routes. `trust proxy` is `1`, not `true`
(express-rate-limit rejects a permissive setting).

### Step 5 — CHECKPOINT
**Model:** haiku · **Status:** done (build clean, 56 tests, tree clean)
Re-ran build + suite, re-confirmed Steps 1–4's Done-when.

### Step 6 — Gate `POST /api/import` behind an explicit, fail-safe option
**Model:** haiku · **Status:** done (`/api/import` gated via `buildRouter(store, {allowImport})` — 3-hit grep verified)
`buildRouter(store, { allowImport = false })` — the route is **not
registered** when hardened (AD-014), not merely blocked; 404 is
indistinguishable from any unknown path. `createApp` passes
`allowImport: !config.hardened`.

### Step 7 — Stop the Angular build emitting an inline `onload` handler (CSP)
**Model:** haiku · **Status:** done (`angular.json` `inlineCritical:false` — built index.html: 0 `onload=`, 0 inline `<style>`)
The one sanctioned `web/` change. Angular's critical-CSS inlining (*beasties*)
emitted `<link ... media="print" onload="this.media='all'">`, an inline event
handler that `script-src 'self'` blocks — every curl check would still return
200 while the app rendered unstyled (found in CriticReview R2, see L-008).
Fixed via `optimization.styles.inlineCritical: false`, not by weakening CSP.

### Step 8 — Serve the built Angular app with an SPA fallback
**Model:** haiku · **Status:** done (SPA fallback middleware added in `app.ts`)
Appended to `createApp`: `express.static(staticDir)` + a fallback middleware
serving `index.html` for GET/HEAD requests outside `/api/` and `/media/` —
written as middleware, not a wildcard route, since Express 5's path-to-regexp
v8 rejects bare `'*'` patterns at startup.

### Step 9 — Rewrite `index.ts` as a thin bootstrap; set `DEV_MODE=1` in the dev script
**Model:** haiku · **Status:** done (`index.ts` thin bootstrap + `DEV_MODE=1` — no-credentials boot exits 1 "refusing to start")
`main()` now: `loadConfig()` (catching `ConfigError` → log + `exit(1)`) →
`FileStore.init()` → `createApp` → `listen`. The SIGINT/SIGTERM `flushAll`
shutdown handler preserved byte-for-byte. `server/package.json`'s `dev` script
now `DEV_MODE=1 tsx watch src/index.ts`.

### Step 10 — CHECKPOINT: dev mode still works
**Model:** haiku · **Status:** done (CHECKPOINT dev mode — hardened:false, `/api/collection` 200, CORS present)
`npm run dev -w server`: startup log `hardened: false`, `/api/collection`
200 with no credentials, CORS header present for a cross-origin request.
Stopped via SIGINT; `data/spanish/` unaffected.

### Step 11 — Automated coverage for the hardened app (A1, A3, A4, A6, A8, A9)
**Model:** haiku · **Status:** done (`app.integration.test.ts` — 15 `it()` blocks, 71 tests total)
Exercises `createApp` directly against a temp-dir `FileStore`
(`process.env.DATA_DIR` set before `createApp`, restored after —
`createApp` reads `dataDir()` once, not per-request). 12 hardened-app cases
(401/200 matrix, wrong credentials, `/api/import` 404, media auth, the
`%2e%2e%2f` path-traversal probe returning 404 with no card JSON in the body,
no CORS header, an 8,000-entry ~320KB resume payload not hitting 413) + 3
dev-app cases (open, import reachable, CORS present).

### Step 12 — Verify by trying: the unauthenticated curl matrix against a real server
**Model:** haiku · **Status:** done (`verify.sh` curl matrix passed against `node server/dist/index.js`)
`specs/013-server-hardening/verify.sh` (kept, re-runnable) builds a scratch
`DATA_DIR` (JSON state copied, `media/` symlinked — read-only in practice) and
runs the shipped binary. Confirms A1/A2/A4/A5 against the real binary, not
just in-process tests — including `--path-as-is '/api/health/../collection'`
unauthenticated → 401 (proves the path isn't silently normalised).

### Step 13 — Study a real card behind the hardened server (A7: CSP, media, review persistence)
**Model:** sonnet · **Status:** done (A7 browser check verified by a human — browser automation cannot answer Chrome's native Basic Auth dialog; see `Analyst.md` retrospective)
The one criterion curl can't reach: does the app actually render styled, does
audio play, does a review persist across reload. Two automated techniques
(userinfo-in-URL, priming the auth cache via a same-origin `fetch()`) both
failed on Chrome's native Basic Auth challenge — see `Analyst.md`
retrospective and L-008's postscript. Verified manually against the Step 12
scratch-dir recipe: styled, no CSP console violations, audio played, rating
persisted across a `/study/:deckId` reload.

### Step 14 — Documentation: how to run it hardened, and what the env vars are
**Model:** haiku · **Status:** done (README/CLAUDE.md/ROADMAP.md updated, Phase 0 checkboxes ticked)
`README.md` "Running the server" section (env vars, hardened-by-default,
`DEV_MODE=1`); two `CLAUDE.md` Server-section bullets (`config.ts`, `app.ts`);
all 6 Phase 0 checkboxes in `specs/011-mobile-remote-access/ROADMAP.md` ticked
with a note that Phase 0 landed as this spec. No real credentials in any doc
— placeholders only.

### Step 15 — Regression, project memory, and wrap-up
**Model:** top-level · **Status:** done (STATE.md AD-011..015 + L-007/L-008, LESSONS.md bodies, Analyst.md retrospective, root STATE.md marker removed)
A1–A10 walked and recorded pass/fail with evidence in `Analyst.md`'s
retrospective (all pass; A7 verified by hand, see Step 13). `specs/STATE.md`
gained AD-011..AD-015; `L-007`/`L-008` written with bodies in
`specs/LESSONS.md`. `bash scripts/clean-table-check.sh` green. Root
`STATE.md`'s `## Executing:` marker removed. Not committed, not archived —
left for the user per this step's own instruction.
