# CriticReview — 013 server hardening

Two harden rounds, per the CLAUDE.md sizing rule for a Large task.

---

## Round 1 — 2026-08-26 (pre-implementation)

Method per `specs/TEMPLATE.md` § "What the critic pass verifies": for every step
that assumes a type, a return value, or a signature defined elsewhere, **open
that file and confirm it**. Nine findings; all applied to `Analyst.md` /
`tasks.md` before implementation.

### R1 — `express-rate-limit` v8 is installed, but the plan used v7's API — FIXED

`npm view express-rate-limit version` → **8.6.2** (helmet → **8.3.0**).
`tasks.md` Step 4 specified `standardHeaders: 'draft-7'`.

Verified against the real type definitions from a throwaway install:

```
378: limit: number | ValueDeterminingMiddleware<number>;
397: legacyHeaders: boolean;
403: standardHeaders: boolean | DraftHeadersVersion;
430: skipSuccessfulRequests: boolean;
```

`limit`, `legacyHeaders` and `skipSuccessfulRequests` are all correct on v8.
`standardHeaders` accepts a boolean, so **`standardHeaders: true`** is valid on
both v7 and v8 and is what the plan now says. Step 1 pins `helmet@^8` and
`express-rate-limit@^8` so a future v9 rename surfaces at install time, not at
runtime. `ERR_ERL_PERMISSIVE_TRUST_PROXY` confirmed present in v8's source, so
Step 4's `If blocked` note is accurate.

### R2 — CSP would have broken the app's styling, and only Step 12 would have caught it — FIXED (new Step 7)

**The most serious finding.** Angular's production build inlines critical CSS
via *beasties*, which emits this into `web/dist/web/browser/index.html`:

```html
<link rel="stylesheet" href="styles-VNB6KQEX.css" media="print" onload="this.media='all'">
```

`onload=` is an **inline event handler**, which `script-src 'self'` blocks. The
stylesheet would have stayed `media="print"` forever and the app would render
essentially unstyled — while every curl check in Step 11 still returned 200.

Three options considered: allow `script-src 'unsafe-inline'` (throws away most
of the CSP's value); add `'unsafe-hashes'` plus the hash of `this.media='all'`
(brittle — the hash changes whenever Angular changes the snippet); or turn off
critical-CSS inlining.

**Chosen: `inlineCritical: false`.** Verified empirically — patched
`web/angular.json`, rebuilt, and the output became:

```html
<link rel="stylesheet" href="styles-VNB6KQEX.css">
```

No `onload`, and the inline `<style>` block disappeared too. `script-src 'self'`
stays strict. Cost is a marginally later first paint, which is irrelevant for a
single-user app. The experiment was reverted; the change is now Step 7.

`style-src 'unsafe-inline'` is still required and stays — Angular injects
component styles at runtime, and note-type CSS is inlined into rendered card
HTML through `bypassSecurityTrustHtml`.

**Scope consequence:** `Analyst.md` §3 said `web/` was entirely out of scope.
Amended — `web/angular.json` **build configuration** is in scope; `web/src/`
remains out. A CSP that breaks the app is not a thing this spec may leave behind.

### R3 — Verification steps mutated irreplaceable live state — FIXED

Steps 11 and 12 ran the hardened server against the real `data/spanish/`, and
Step 12 *rated a real card*. That writes real scheduling state — and Step 12's
"Done when" cheerfully instructed the executor that a dirty `data/spanish/` was
expected.

This contradicts the roadmap's non-negotiable #2 ("progress is never lost") in
the spec whose entire purpose is to uphold it. Verification must not be able to
damage the asset it is protecting.

Both steps now run against a scratch `DATA_DIR`: the ~5.5 MB of JSON state is
copied, and `media/` (252 MB) is **symlinked** rather than copied, which keeps
it fast and read-only in practice. `FileStore.init()` calls
`mkdirSync(..., { recursive: true })` over the media path, which is a no-op on
an existing symlink-to-directory. `data/spanish/` must now be clean after every
verification step, which restores L-002 as a usable signal instead of an
expected-dirty exception.

### R4 — Step 10's justification contradicted the code (L-001) — FIXED

Step 10 told the executor to set `process.env.DATA_DIR` before `createApp`
"because `dataDir()` is read at request time by the `/media` mount". It is not:
`app.use('/media', express.static(join(dataDir(), 'media'), …))` evaluates
`dataDir()` **once**, when `createApp` runs.

The instruction was right and the stated reason was wrong — which is exactly the
shape of **L-001** ("a doc that contradicts the code is worse than no doc; it
gets copied"). A future reader would have concluded `DATA_DIR` could be changed
per-request. Reason corrected.

### R5 — Test-count arithmetic was wrong and partly unpredictable — FIXED

Baseline confirmed by running the suite: **39 server tests across 7 files.**

Step 10 claimed "+14" against a list that actually enumerated **15** cases.
Worse, Steps 2 and 3 described case *categories* ("`bodyLimit` defaults and
overrides") from which an executor could reasonably write one `it()` or two —
so the stated total was unpredictable in principle, and the template's whole
reason for demanding a count (a silently skipped suite is visible) was lost.

Each test step now specifies an **exact number of `it()` blocks** with a
one-line enumeration. Corrected chain: 39 → **47** (Step 2, +8) → **56**
(Step 3, +9) → **71** (Step 11, +15). `Analyst.md` A10 updated from 39 to 71.

### R6 — `curl` normalises `..`, so Analyst A1's traversal check proved nothing — FIXED

A1 listed `curl http://localhost:3000/api/health/../api/collection`. curl
resolves `..` in the path *before* sending, so the server only ever saw
`/api/collection` — the check duplicated the line above it. Replaced with
`--path-as-is` plus an encoded `%2e%2e%2f` variant, which is what actually
reaches the server. The in-process traversal assertions in Step 11 (via `fetch`)
were already sound.

### R7 — Step 9 depended on the Angular dev server for no reason — FIXED

Step 9 ran the full `npm run dev` (both processes) and asserted
`http://localhost:4200` → 200. Nothing in this spec touches
`web/proxy.conf.json`, the Angular dev server, or anything under `web/src/`, so
that assertion could only produce false failures from an unrelated moving part —
and orchestrating two backgrounded processes is the least reliable thing a small
executor can be asked to do. Narrowed to `npm run dev -w server` alone.

### R8 — Signature and path assumptions confirmed sound (no change)

Opened and verified, per the template's instruction not to trust the plan's own
account of the code:

- `buildRouter(store: FileStore): Router` — `routes/index.ts:26`. Three callers:
  `index.ts:21` (rewritten in Step 9), `notes.integration.test.ts:49`,
  `resume.integration.test.ts:79`. Neither test hits `/import`, so Step 6's
  `allowImport` defaulting to `false` is backwards-compatible. Confirmed.
- **Angular output path** — built it rather than assuming:
  `web/dist/web/browser/index.html` exists. `config.ts`'s
  `join(repoRoot, 'web', 'dist', 'web', 'browser')` is correct.
- **Express 5.2.1** confirmed, so Step 8's warning about bare `'*'` route
  patterns (removed in path-to-regexp v8) is real, and the middleware-based SPA
  fallback is the right form.
- `repoRoot = resolve(here, '..', '..')` resolves correctly from **both**
  `server/src/` (tsx) and `server/dist/` (built) — same derivation `paths.ts`
  already relies on.
- No vitest config file exists, so vitest's default include picks up the new
  `config.test.ts`, `middleware/auth.test.ts` and `app.integration.test.ts`
  without configuration.
- **No remote hosts** are referenced by any field in `notes.json` (scanned all
  notes for `src=`/`href=` with an `http(s)://` host: zero hits), so
  `img-src 'self' data:` and `media-src 'self'` will not break existing cards.

### R9 — Body-cap sizing re-derived from the data, not assumed (no change)

`POST /api/collection/resume` sends `{id, due}` per card. Measured against the
live store: **7,276 cards → 318,367 bytes** of JSON. The 2 MB cap in the plan
gives ~6x headroom; a "sensible-looking" 100 KB or 256 KB cap would have
silently broken pause/resume with a 413 while `pausedAt` stayed set. Step 11's
8,000-entry resume test sits just above today's real payload, so it is a genuine
regression guard rather than a token one. Confirmed correct as planned.

---

## Round 2 — 2026-08-26 (post-fix consistency sweep)

Re-read `tasks.md` end to end after the Round 1 edits, checking the things
Round 1's edits could themselves have broken.

### R10 — Step renumbering after inserting the CSP step — VERIFIED

R2 inserted a new step, shifting the back half by one (old Step 7 → 8, … old
Step 14 → 15; **15 steps total**). Every `Depends on:` reference, the header
count, the checkpoint positions and the cross-references in "If blocked" were
re-checked against the new numbers. Checkpoints now fall at Steps 5 and 10,
preserving the "~every 4 steps" rule.

### R11 — The `DEV_MODE` fail-safe default and the test suite — VERIFIED

D2 makes hardened the default, which raised the question of whether any
*existing* test would now hit auth. Confirmed not: `notes.integration.test.ts`
and `resume.integration.test.ts` assemble their own bare Express app
(`express()` + `cors()` + `express.json()` + `buildRouter(store)`) and never
call `createApp` or `loadConfig`. They are untouched by the hardened stack. The
new `app.integration.test.ts` constructs `ServerConfig` objects literally rather
than through `loadConfig`, so it never reads `process.env` for credentials
either. No test can be made to pass or fail by an ambient `DEV_MODE`.

### R12 — Ordering assertion in Step 4's "Done when" is grep-checkable — VERIFIED

The middleware order is the substantive content of Step 4, and "read the file
and check the order" is exactly what a small executor declares done
optimistically. The `grep -n` check emits line numbers for `basicAuth`,
`express.json` and `app.use('/api'`, making the ordering claim mechanically
checkable rather than a matter of the executor's word.

### R13 — Residual risks accepted, not fixed

Written down rather than solved, so they are visible at Phase 1:

- **`/api/health` is anonymous** (Analyst §2.2). It leaks liveness only. Worth
  revisiting at Phase 1 whether a Fly **TCP** health check would close even this.
- **Basic credentials are re-sent on every request.** Acceptable only over
  HTTPS, which §2.4 enforces and Fly terminates. If the phone re-prompts
  annoyingly on cold starts, D1 already names the session-cookie follow-up.
- **A future scrape yielding remote image/audio URLs would be CSP-blocked.**
  Zero such URLs exist today (R8). The failure would be visible (a broken image,
  a console violation), not silent, so no pre-emptive loosening.
- **`style-src 'unsafe-inline'` remains**, forced by Angular's runtime style
  injection and by note-type CSS rendered through `bypassSecurityTrustHtml`.
  Combined with `bypassSecurityTrustHtml` on scraped content, this is the same
  accepted risk already recorded as audit **C2**; this spec does not widen it.
- **No CSRF token.** Basic auth is not ambient the way a cookie is — a browser
  does not attach Basic credentials to cross-site requests it did not already
  have a realm for — and `frameAncestors: 'none'` plus the absence of CORS in
  production closes the practical vectors. A cookie-session follow-up (D1)
  **would** need CSRF protection; noted so that decision is not made blind.
