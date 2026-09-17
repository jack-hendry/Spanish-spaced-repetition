# CriticReview — harden round 1 (of 2)

**Target:** `Analyst.md` (pre-`tasks.md`)
**Date:** 2026-09-16
**Verdict:** NOT ready for a `tasks.md`. Three blockers change *what gets
built*, not just how it is described.

Run by an independent agent with no context from the drafting session, briefed
to verify every code claim against the actual files rather than re-read the
plan for internal consistency (`specs/TEMPLATE.md` › "What the critic pass
verifies"). All findings below were **re-verified by the top-level session**
against the cited lines before being recorded here.

## Blockers

### C1 — Overrides the roadmap's ordering rule without acknowledging it

`specs/011-mobile-remote-access/ROADMAP.md:32` — "**Ordering rule:** Phases 0–2
must all land before the server is publicly reachable." The Analyst makes the
server publicly reachable (§2.5, §6.5) while declaring Phase 2 (backups)
out of scope (§3). Its interim rule — "desktop stays authoritative, Fly not
trusted for a real session" — is prose standing in for a MUST the roadmap
already wrote.

**Resolution required from the user.** Three options: fold a minimal
restore-tested copy-off-Fly into this phase; run Phase 2 before Phase 1; or
knowingly override, recorded as an `AD-NNN`. Silently omitting is not an
option.

### C2 — The `cards.json` sentinel disarms itself on its own first boot

`server/src/store/file-store.ts:106` —
`if (!existsSync(this.path('cards'))) await this.flush('cards');`

`init()` **creates** `cards.json` as `[]` whenever it is absent. So the exact
sequence D2 prescribes (boot once with `ALLOW_EMPTY_STORE=1` to seed the
volume) writes `cards.json` permanently. Every subsequent boot passes the
sentinel *whether or not the real state was ever uploaded*, and the first
review then persists a blank store — the precise loss D2 exists to prevent.

D2's claim that "`cards.json` is the file whose absence means 'no scheduling
state here'" is **false in production after boot #1**.

**Fix:** the sentinel must check *content*, not presence — refuse when
`cards.json` is missing **or** parses to an empty array — and must run
**before** `store.init()` (`server/src/index.ts:19`), since `init()` would
otherwise satisfy it. Add an acceptance criterion for the `cards.json = []`
case specifically.

### C3 — Acceptance criterion 8 (graceful-stop flush) cannot fail

The debounce is 400ms (`file-store.ts:77`). "Answer a card, immediately
`fly machine stop`" cannot beat that: the pending timer fires on its own and
the file is on disk regardless of `flushAll()`. The criterion passes with
`flushAll()` deleted, so it proves nothing.

**Fix:** replace with a deterministic server test. The constructor already
accepts the knob (`file-store.ts:72-77`): `new FileStore(tmp, { debounceMs:
60_000 })` → `saveCardsSoon()` → assert file unchanged → `flushAll()` →
assert written. Keep the `fly machine stop` run as a smoke check only, and
label it as such.

Note: `server/src/index.ts:18` hardcodes the default, so `debounceMs` cannot
be raised in production via env — the test is the only place this is provable.

## Should-fix

### C4 — Criterion 9 performs 20 *real* reviews with no reconciliation path

`ROADMAP.md:33` — "Phases 3–4 must land before the phone is trusted for a real
session." Those 20 reviews mutate Fly's `cards.json`/`revlog.ndjson` and
immediately diverge from git; "desktop stays authoritative" then means they
are discarded, and no step says so. The 20-vs-200 downgrade is argued
backwards: 20 carries the same *class* of risk as 200, so it is a smaller
sample, not a safety measure.

**Fix:** verify against a scratch volume / throwaway `DATA_DIR`, add an
explicit post-verification step (pull and commit, or wipe and re-seed), and
re-justify 20 as "smoke test on disposable state".

### C5 — Criterion 7 checks `ALLOW_EMPTY_STORE` absent but not `DEV_MODE`

`server/src/config.ts:29` — `hardened = env.DEV_MODE !== '1'`. One stray
`DEV_MODE=1` on Fly disables auth, reopens CORS, re-enables `/api/import`
(`app.ts:99`) *and* disables the proposed sentinel (D2 gates on `hardened`).
Total defeat of non-negotiable #1 via a single env var.

**Fix:** criterion 7 must also assert `DEV_MODE` is absent.

### C6 — The image-layout invariant `staticDir` depends on is never stated

`config.ts:11-12` + `paths.ts:7-9` — `repoRoot = resolve(dirname(compiled js),
'..', '..')`. With `outDir: dist` / `rootDir: src`, `config.js` lands at
`server/dist/config.js`, so `staticDir` = `<root>/web/dist/web/browser`. A
conventional `COPY --from=build /app/server/dist ./dist` silently yields
`staticDir: null` — a 404-ing app with a perfectly working `/api`.

**Fix:** add a decision pinning the image layout: `<root>/server/dist`,
`<root>/web/dist/web/browser`, and hoisted `<root>/node_modules`.

(`DATA_DIR` itself overrides cleanly — `paths.ts:12` — so **D1 is correct**.)

### C7 — No deployed-instance auth verification

Phase 0 already shipped a curl matrix at
`specs/archive/2026-08-27-013-server-hardening/verify.sh` covering `/api`,
`/media`, path traversal and CORS. The Analyst never mentions reusing it.

**Fix:** add a criterion running `verify.sh` against `https://<app>.fly.dev`,
plus a plain-`http://` → 308 check.

## Discovered (record, do not fix here)

- **C8** — `app.ts:70-78`: the tier-1 limiter (20 failures / 15 min,
  `skipSuccessfulRequests`) applies to *all* routes. An Angular page load 401s
  on several parallel requests before credentials are entered; two mistyped
  passwords plus a few missing-media 404s can burn 20 and lock the app out for
  15 minutes — during criterion 9, which explicitly checks audio. Add a
  pre-phone step verifying media file count matches the desktop, and note the
  lockout as expected-and-benign so it is not misdiagnosed.
- **C9** — `routes/index.ts:116-123`: `/review` calls `saveCardsSoon()`
  (debounced) but `await store.appendRevlog(...)` (immediate). A hard kill
  inside the window leaves the revlog claiming a review `cards.json` does not
  reflect. Not introduced by this phase, but Fly's auto-stop makes it
  reachable for the first time, and it is exactly the divergence Phase 2's
  "rebuild from revlog" note assumes.
- **C10** — Base image and Node major are unpinned. The Angular build needs
  devDependencies, so `NODE_ENV=production` before `npm ci` breaks the build.
  `web/package.json` carries `"packageManager": "npm@11.13.0"`, which can
  trigger a Corepack download on an older-npm base. Dev is Node v24.16.0.
- **C11** — Criterion 6 redeploys with no review in flight, so it never
  exercises the deploy-time flush (answer a card first, *then* deploy).
  Criterion 2's `curl -u $USER:$PASS` will not run as written: `$USER` is
  already the shell's login name.

## Verified and NOT problems

Recorded so round 2 does not re-litigate them:

- **Container timezone is not a correctness risk.** `todayNumber()` lives in
  `web/src/app/core/collection.store.ts:50-53` and runs in the browser; no
  `new Date(`/`getTimezoneOffset` anywhere in `server/src/`.
  `collection.created` is epoch ms. Day numbers follow the *device's* TZ,
  never the container's. (`TZ=America/Toronto` remains harmless insurance, not
  a fix.)
- **D7 is right, and for a better reason than stated.** `/api/health` is
  registered at `app.ts:43`, *before* `forceHttps`, helmet, both limiters and
  `basicAuth` — so Fly health checks never consume rate-limit budget.
- **`trust proxy` is safe.** `app.ts:39` sets the integer `1`, not `true`, so
  express-rate-limit v8's `ERR_ERL_PERMISSIVE_TRUST_PROXY` validator does not
  fire. Fly's actual hop depth was not verifiable without deploying; with a
  single user a wrong depth merely merges everyone into one bucket.
- **Range requests work.** `express.static` has `acceptRanges` on by default
  and helmet's CSP `mediaSrc: 'self'` does not interfere — audio seeking is
  fine.
- **D4's shutdown reasoning holds.** `index.ts:34-37` awaits `flushAll()`
  *before* `server.close()`, so a lingering keep-alive socket delays exit but
  never the flush.
- **`npm ci` with workspaces + `lockfileVersion 3`** installs both workspaces
  from root correctly.

---

# Harden round 2 (of 2)

**Target:** `tasks.md` revision 1 (19 steps) + `Analyst.md` revision 2
**Date:** 2026-09-16
**Verdict:** was NOT ready to execute. Three blockers, each a step that could
not do what it said. All folded into `tasks.md` revision 2 (22 steps).

Same agent, resumed with round-1 context so it could check whether its own
blockers were fixed *in kind* or merely reworded. Findings re-verified by the
top-level session before recording.

## Blockers

### R1 — Step 13 verified the deployment with a script that tests localhost

The worst kind of defect: not a step that fails loudly, but one that passes
while proving nothing.

`specs/archive/2026-08-27-013-server-hardening/verify.sh` accepts **zero
arguments** (`grep -cE '\$1' → 0`), hardcodes `localhost:3999` in **15**
places, and lines 10-22 **start its own local server** from a scratch
`DATA_DIR`. So `bash verify.sh https://spanish-srs.fly.dev` silently ignores
the argument, tests localhost, and prints all-green — while non-negotiable #1
went completely unverified against the real deployment.

*(Independently confirmed: 0 argument references, 15 `localhost:3999` hits,
and the `node server/dist/index.js &` block at line 20.)*

**Fixed:** new Step 10 creates `tools/verify-remote.sh`, parameterized and
starting no local server. Step 17 runs it, and its Done when requires the
output to visibly name `spanish-srs.fly.dev`. The archived original is left
untouched — finished history.

### R2 — The restore the phone test depends on had no tool

Step 14 created only `tools/pull-fly-state.sh`; nothing in 19 steps created a
push/restore counterpart, yet Step 18 called for "restore the pre-test state".
That left an unscripted seven-file overwrite of the only remote copy of
scheduling state — a larger risk than the 20 reviews it was protecting.

**Fixed:** new Step 12 creates `tools/push-fly-state.sh`, mirroring the pull
script's temp-dir-then-move discipline and refusing to run without `--yes`.
Step 21 uses it. It is also the rollback path for Step 15.

### R3 — Step 4 ordered its executor to edit a file the same step forbade

`Files` said `DO NOT TOUCH: server/src/store/file-store.ts`; `Done when` said
"temporarily stub the body of `flushAll()`". A haiku executor gets
contradictory orders and either refuses or leaves the tree dirty — the very
outcome the trailing `git diff --quiet` was trying to catch after the fact.

**Fixed:** falsifiability is now structural, not procedural. Test C uses fake
timers to advance past the debounce after `flushAll()` and asserts **no second
write** — proving the pending timer was cleared (`file-store.ts:163-166`),
which a stubbed `flushAll()` fails. No source edit, and the check stays in the
suite permanently.

## Should-fix (all folded in)

- **R4 — Step 12 printed `AUTH_PASSWORD` into the transcript.** Fly injects
  secrets as env vars, so `fly ssh console -C "printenv"` dumps the password —
  two steps after Step 10 said never to echo it. Now piped through
  `grep -cE '^(ALLOW_EMPTY_STORE|DEV_MODE)='`, expecting `0`.
- **R5 — The sentinel was blind to the likeliest partial seed.** It checked
  only `cards.json`, and Step 11's own `If blocked` admitted a partially-seeded
  volume with a populated `cards.json` would pass. An interrupted or
  alphabetical upload lands `cards.json` before `notes.json`. Now checks both.
  Test counts adjusted: 76 / 79 / 82.
- **R6 — The `Model:` preamble cited a CLAUDE.md section that does not exist.**
  "Executing actions with care" is from the session's system prompt, not
  `CLAUDE.md` (`grep -in "executing actions" CLAUDE.md` → no match). The
  citation was fabricated and is deleted. Separately,
  `enforce-haiku-tasks-pretooluse.sh:76` ask-gates top-level verification Bash
  during a run, so marking verification steps `top-level` fights the harness
  for no benefit. Only Steps 14, 21 and 22 remain `top-level`.
- **R7 — Autostop would have killed the 259MB seed upload.** `fly ssh sftp`
  generates no HTTP traffic, so `auto_stop_machines = "stop"` +
  `min_machines_running = 0` stops the machine mid-transfer, and flyctl's sftp
  has no resume — turning Step 11's "re-run until counts match" into a loop.
  Step 15 now pins the machine up for the seed and Step 16 restores the setting.
- **R8 — A usability window, not a data window.** The critic traced the
  ordering and confirmed **no reviews occur between the seed and the verified
  restore**, so D0 genuinely closes C1 rather than papering over it. But the
  app becomes live and fully working at Step 16 with nothing telling the user
  not to use it. Step 16 now says so explicitly.

## Recorded (not fixed here)

- **R9 — No rollback existed anywhere in 22 steps.** Added as explicit
  paragraphs to Steps 15 and 16: `data/spanish/*.json` is git-tracked, and
  `fly releases` / `fly deploy --image <previous>` returns to a prior deploy.
- **R10 — Nothing verified the machine actually sleeps**, which is what makes
  the ~$1–3/mo estimate true. Step 19 now checks it behaviourally.
- **R11 — Minor accuracy.** File counts added to Step 4's Done when;
  `$CLAUDE_JOB_DIR/tmp` replaced with `mktemp -d` (per-job and may not exist);
  line citations corrected (`file-store.ts:76` is the debounce default, not 77;
  `/review` starts at `routes/index.ts:114`).

## Found by the top-level session, not the critic

- **Architecture mismatch.** The dev machine is `linux/aarch64`; Fly's
  `shared-cpu-1x` is `x86_64`. `fly deploy` uses Fly's remote builder by
  default so the deployed image is amd64 regardless — but that means **the
  image verified locally is not the image deployed**. Step 7 now states this
  and adds a `--platform linux/amd64` build to prove the Dockerfile builds for
  the deploy target. (Verified locally: daemon 29.4.0, `node:24-bookworm-slim`
  runs Node v24.21.0.)

## Verified correct — do not re-litigate

- **Test arithmetic.** Baseline independently re-run: **71 tests, 10 files**.
- **Anchors exist as written**: `const hardened = env.DEV_MODE !== '1';`
  (`config.ts:29`), `const store = new FileStore(dataDir());` (`index.ts:18`),
  and the temp-dir pattern (`file-store.migration.test.ts:19-26`).
- **C2 is fixed in kind, not reworded** — content-based, and Step 3 forces the
  call before `store.init()` with a grep that checks line ordering.
- **Every step ends at a green build.** Step 2's module is unused until Step 3
  wires it; nothing leaves the tree non-compiling.
- **Step 9's Fly syntax is correct**: `auto_stop_machines = "stop"` (string
  form), `[[http_service.checks]]`, top-level `kill_timeout`, `[[mounts]]` at
  `/data`. D8's Dockerfile layout reasoning is right.

## Status

Two harden rounds are complete, as the Large sizing requires. The round-2
verdict was that fixing R1–R6 and folding in R7–R8 makes this executable, and
that a round 3 would not be expected to find anything structural. That work is
done — `tasks.md` revision 2 carries all of it.

**Remaining before execution: user review, and adding the
`## Executing: 021-fly-deploy` marker to the root `STATE.md`** so
`enforce-haiku-tasks-pretooluse.sh` arms (CLAUDE.md; L-004, L-005 — the
example marker in that file is indented by two spaces on purpose).
