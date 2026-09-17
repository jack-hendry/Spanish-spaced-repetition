# Analyst — Phase 1: deploy to Fly.io

Implements Phase 1 of `specs/011-mobile-remote-access/ROADMAP.md`, plus the
load-bearing slice of Phase 2 (see D0). Phase 0 (server hardening) landed in
`specs/archive/2026-08-27-013-server-hardening`.

**Size: Large.** Touches deploy infrastructure, the server boot path, and the
on-disk data location. Per `CLAUDE.md`: full spec + 2 harden rounds + a review
after coding.

**Revision 2** — rewritten after harden round 1 (`CriticReview.md`). C1–C7 are
folded in; C8–C11 are recorded under `## Discovered`.

## 1. What problem are we solving?

Reviews can only be done at the desktop, because the app only exists on the
desktop. The server is hardened (auth, HTTPS forcing, CORS lockdown, rate
limits, contained `/api/import`) and already serves the built Angular app from
one process — it is ready to be exposed, but nothing exposes it.

Phase 1 makes one URL reachable from a phone over cellular, with the
scheduling state living on storage that survives a redeploy **and** a copy of
that state landing back on the desktop where git can see it.

The specific hazard this phase must not walk into: `FileStore.init()`
(`server/src/store/file-store.ts:84`) treats an empty data dir as "seed a
fresh collection" rather than an error. On Fly, a volume that fails to mount
leaves an empty directory — so a misconfigured mount does not crash, it
silently starts a blank app, and the first review then **persists** that blank
state. That is the classic Fly data-loss story, and against non-negotiable #2
("progress is never lost") it is the worst outcome available in this project.

## 2. What is in scope?

1. **A `Dockerfile`** that builds both workspaces and runs one Node process
   serving `/api`, `/media` and the Angular app.
2. **A `fly.toml`** pinning internal port, HTTPS, health check, auto-stop/
   auto-start, kill timeout, TZ, and the volume mount.
3. **An empty-store sentinel** in the server boot path (D2).
4. **A `.dockerignore`** so `data/`, `node_modules/`, `dist/` and `specs/`
   stay out of the build context.
5. **Provisioning**: Fly app, 1GB volume, `AUTH_USER`/`AUTH_PASSWORD` as Fly
   secrets.
6. **Seeding the volume** with the current `data/spanish/` — including
   `media/`, which is 252MB, gitignored, and not in the build context.
7. **A pull-state-from-Fly script plus a verified restore** (D0) — the
   minimum that makes the ordering rule honest.
8. **Verification**, on the real deployment: redeploy preserves state,
   graceful stop flushes debounced writes, Phase 0's `verify.sh` matrix still
   passes against the public hostname, a phone on cellular can complete a
   session against disposable state.

## 3. What is OUT of scope?

Named explicitly, because each is a later roadmap phase and folding any of
them in here is the drift this harness exists to prevent:

- **The rest of Phase 2.** D0 lands the pull + restore. Still out: the
  retention window, any scheduled/automated pull, Fly volume snapshots, and
  the revlog-rebuild repair tool.
- **Review-outbox / retry on flaky connections — Phase 3.**
- **Staleness precondition on `/api/review` — Phase 4.**
- **Mobile UI fixes — Phase 5.** This phase's phone pass only *records* what
  breaks; it fixes nothing.
- **A custom domain.** The free `*.fly.dev` hostname and its cert suffice.
- **CI/CD auto-deploy on push.** Deploys stay manual (`fly deploy`).
- **Changing scheduling, the study queue, or the on-disk shape.**

## 4. Decisions

### D0 — Fold a minimal backup into this phase; Fly is the source of truth

`ROADMAP.md:32` states: "Phases 0–2 must all land before the server is
publicly reachable." Revision 1 of this document made the server publicly
reachable while declaring Phase 2 out of scope, and substituted a prose
interim rule ("desktop stays authoritative") for that MUST. That was C1, and
it was a fig leaf: once the app works on a phone it will be used, and the
reviews it collects would have had nothing backing them up.

**Decision (user, 2026-09-16): fold the load-bearing slice of Phase 2 in.**

- **Fly is the source of truth** once deployed. This is the roadmap's
  "Fly-as-source" option, one of the two it already names — so choosing it
  resolves Phase 2's question rather than inventing new policy. Record it as
  an `AD-NNN` in `specs/STATE.md`.
- A script pulls the six state files (`collection.json`, `notetypes.json`,
  `decks.json`, `deckoptions.json`, `notes.json`, `cards.json`) plus
  `revlog.ndjson` off the volume to `data/spanish/`, where the existing git
  workflow takes over. Media is excluded (D3).
- The **restore path is verified in this phase**, not assumed: restore into a
  scratch `DATA_DIR` and study one card against it. An untested backup is a
  guess.
- Run manually. Automation, retention and snapshots stay in Phase 2.

### D1 — Volume mounts at `/data`, `DATA_DIR=/data/spanish`

Not mounting directly at the data dir. If the volume fails to mount, `/data`
is ordinary container filesystem and `/data/spanish` does not exist — exactly
the condition D2 detects. Mounting at the data dir itself would make a failed
mount present as "an empty but existing data dir", harder to tell from a
genuine first boot.

`server/src/paths.ts:12` already honours `DATA_DIR`; no code change needed.
*(Confirmed correct in harden round 1.)*

### D2 — Sentinel: refuse to boot on an empty store *by content*

Revision 1 checked whether `cards.json` **exists**. That was wrong (C2):
`file-store.ts:106` — `if (!existsSync(this.path('cards'))) await
this.flush('cards')` — means `init()` *creates* `cards.json` as `[]` whenever
it is absent. The first `ALLOW_EMPTY_STORE=1` boot would therefore write the
file permanently, and every later boot would pass the sentinel whether or not
real data was ever uploaded. The guard would have disarmed itself on the one
boot it was designed around.

Corrected:

- The check is on **content**: refuse when `cards.json` is missing **or**
  parses to an empty array.
- It runs **before `store.init()`** (`server/src/index.ts:19`), because
  `init()` would otherwise satisfy it.
- `ALLOW_EMPTY_STORE=1` remains the only way past it, following the fail-safe
  pattern `config.ts` already establishes. Absent the flag the process prints
  the path it examined and exits 1.
- Gated on `config.hardened`, so `npm run dev` (which sets `DEV_MODE=1`) keeps
  seed-on-empty.

The escape hatch is required, not optional: a volume can only be seeded while
a machine is running, so the very first boot is legitimately empty. It is set
for that one boot and removed immediately after (verified by criterion 9).

### D3 — Media lives on the volume, not in the image

252MB, gitignored, regenerable only by re-running the converter. Baking it in
would mean a ~300MB image rebuilt and pushed on every deploy, and it would
still have to be excluded from the build context because it is not in git.
Uploaded to the volume once.

Volume sizing: `data/spanish/` is 259MB total (252MB media, ~5.5MB state).
Fly's minimum is 1GB at $0.15/mo — cheapest *and* a comfortable ceiling.
Revisit past ~700MB media.

### D4 — `auto_stop_machines = 'stop'`, `kill_timeout = 30`

`stop` sends SIGINT/SIGTERM, the exact path `server/src/index.ts:33` handles
with `flushAll()`. `suspend` preserves process state instead of signalling, so
the ~400ms `saveCardsSoon()` debounce would resume rather than flush. 30s is
~75x the debounce window.

`min_machines_running = 0` — usage is occasional by design, and the roadmap's
~$1–3/mo estimate assumes the machine sleeps.

*Harden round 1 confirmed `index.ts:34-37` awaits `flushAll()` before
`server.close()`, so a lingering keep-alive socket delays exit but never the
flush, and that `fly deploy` on a single volume-bound machine uses the same
signal path as `stop`.*

### D5 — Hand-written `Dockerfile` and `fly.toml`; `fly launch --no-deploy`

`fly launch` scaffolds and overwrites these based on its own framework
detection, which will not get a two-workspace npm monorepo with a volume
right. Files first; `fly launch --no-deploy` only registers the app.

### D6 — `primary_region = "yyz"`, `TZ=America/Toronto`

User is in Toronto (`America/Toronto`, UTC-4); `yyz` is a Fly region. Fly's
edge served from `iad`, which is also fine — the difference is ~10-20ms and
one line to change.

`TZ` is **insurance, not a fix**: harden round 1 verified that `todayNumber()`
lives in `web/src/app/core/collection.store.ts:50-53` and runs in the
*browser*, that `server/src/` contains no `new Date(`/`getTimezoneOffset`, and
that `collection.created` is epoch ms. Day numbers follow the device's TZ,
never the container's. Setting it costs nothing and removes a class of future
surprise if server-side date logic is ever added.

### D7 — Health check stays anonymous

`GET /api/health` is the one deliberately-anonymous route, because Fly's HTTP
checks cannot authenticate. It returns `{ok:true}` and nothing about the
store — that property must not change.

*Harden round 1 found this is right for a better reason than stated: it is
registered at `app.ts:43`, before `forceHttps`, helmet, both rate limiters and
`basicAuth`, so health checks never consume rate-limit budget.*

### D8 — The image must preserve the repo layout (C6)

`config.ts:11-12` and `paths.ts:7-9` compute
`repoRoot = resolve(dirname(<compiled js>), '..', '..')`. With `outDir: dist`
/ `rootDir: src`, `config.js` lands at `server/dist/config.js`, so
`staticDir` resolves to `<root>/web/dist/web/browser`.

A conventional `COPY --from=build /app/server/dist ./dist` silently yields
`staticDir: null` — a 404-ing app with a perfectly working `/api`, which is a
confusing thing to debug after a deploy. The runtime image must therefore
keep:

```
<root>/server/dist/        <- compiled server
<root>/web/dist/web/browser/   <- built Angular
<root>/node_modules/       <- hoisted workspace deps
```

`npm run build`'s output layout must not be restructured to "tidy" the image.

### D9 — Pin the base image; do not set `NODE_ENV=production` before `npm ci`

Dev runs Node v24.16.0; Angular 22 + TS ~6.0.3. Base image
`node:24-bookworm-slim` for both stages.

Two traps (C10): the Angular build needs **devDependencies**, so
`NODE_ENV=production` before `npm ci` breaks it; and `web/package.json`
carries `"packageManager": "npm@11.13.0"`, which can trigger a Corepack
download on a base image with older npm.

*Harden round 1 confirmed `npm ci` with workspaces + `lockfileVersion 3`
installs both workspaces correctly from the root.*

### D10 — Shared IPv4, never dedicated

**A dedicated public IPv4 costs $2/mo — more than everything else in this
deployment combined.** A shared IPv4 is free, and works for HTTP/HTTPS through
Fly's proxy, which is all this app needs. Fly's own docs warn that "each http
app gets billed $2/month if you assign it a dedicated public IPv4" but do not
explain how to avoid it, and `fly launch` can allocate one without asking.

`fly ips list` must show a **shared** v4 (or v6 only). If a dedicated v4 was
allocated, `fly ips release <addr>` it and allocate shared instead. This is
verified in criterion 13, not assumed.

### D11 — The runtime image ships production dependencies only

Measured: the full `node_modules` is **287MB** (Angular, TypeScript, vitest and
the rest of the build toolchain). The server's actual runtime dependencies are
`express`, `cors`, `helmet` and `express-rate-limit` — ~420KB direct. The built
Angular app is 456KB of static files and needs no `node_modules` at all at
runtime; the compiled server is 332KB.

So the build stage needs devDependencies (D9) but the **runtime stage must
not copy them**. Copying all 287MB would roughly double the image, slow every
deploy, and enlarge the attack surface for no benefit.

This interacts with D8: the runtime stage still needs hoisted deps at
`<root>/node_modules`, so it runs its own production-only install rather than
copying the build stage's tree wholesale.

The billing effect is small (~$0.04/mo of stopped-rootfs), so this is mostly
about deploy speed and surface area — it is not the load-bearing cost control.
D10 is.

## 5. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Volume fails to mount, app seeds blank, first review persists it | Silent total loss of scheduling history | D2 sentinel, content-based, before `init()` |
| Sentinel passes on a `cards.json` that `init()` itself wrote | The guard disarms on the one boot it exists for | D2 checks content, not presence (C2) |
| Auto-stop hard-kills before the debounced `cards.json` write lands | Loses the last few reviews of every session | D4 + criterion 8's deterministic test |
| `ALLOW_EMPTY_STORE=1` left set after seeding | Sentinel permanently disarmed | Removing it is its own verified step (criterion 9) |
| A stray `DEV_MODE=1` on Fly | Disables auth, CORS, `/api/import` guard *and* the sentinel — total defeat of non-negotiable #1 via one env var | Criterion 9 asserts it absent (C5) |
| `web/dist` missing or relocated in the image | Half-working deploy: `/api` fine, app 404s | D8 + criterion 3 (local run before any deploy) |
| Fly holds reviews nothing backs up | Non-negotiable #2 | D0 — pull + verified restore in this phase |
| Phone verification writes real reviews that then get discarded | Small but real instance of the same failure mode | Criterion 10 runs against disposable state (C4) |

## 5a. Cost

Verified against fly.io/docs/about/pricing and fly.io/plans on **2026-09-16**.
This supersedes the ROADMAP's 2026-08-26 estimate, which missed the IPv4 line
item.

**There is no minimum spend, no base platform fee, and no required
subscription.** Billing is purely metered; machines are billed by the second
while running. (The $29/$199/mo figures on the plans page are optional
*support* plans, not required to run an app.)

| Line item | Rate | This deployment |
|---|---|---|
| Volume, 1GB | $0.15/GB/mo | **$0.15/mo** — billed even while the machine is stopped |
| Stopped-machine rootfs | $0.15/GB per 30 days | **~$0.07/mo** at a ~500MB image (D11) |
| Compute, shared-cpu-1x 256MB | $0.0027/hr | **$0.04–0.24/mo** — 15 hr/mo light use to 90 hr/mo heavy |
| Egress, North America | $0.02/GB | **~$0.01/mo** — a session is ~20MB including audio |
| Shared IPv4 | free | **$0.00** (D10) |
| TLS cert on `*.fly.dev` | free | **$0.00** — first 10 per org |

**Realistic total: $0.25–$0.50/month.**

### The ceiling, which matters more than the estimate

Fly has **no hard spending limits and no billing alerts** — its own docs say
"We don't support billing alerts (yet), so budget accordingly." So the
protection cannot be a cap; it has to be that the architecture's worst case is
small by construction.

It is. There is exactly **one** machine of fixed size and **one** volume of
fixed size. No autoscaling, no per-request pricing, no managed services. The
pathological case — a dedicated IPv4 slipping in *and* the machine never
sleeping — is:

> $2.00 (dedicated IPv4) + $1.94 (always-on machine) + $0.15 (volume)
> + $0.07 (rootfs) ≈ **$4.16/month**

That is the realistic worst case, and it is ~8x the expected cost, not 100x.

The only unbounded meter is egress, and it is bounded in practice by auth:
every route including `/media` requires credentials (Phase 0), so nobody else
can pull the 252MB media library. Reaching even $10 of egress would take
~500GB — roughly 2,000 full downloads of the entire library.

### What actually controls the cost

In descending order of impact:

1. **Shared IPv4 (D10)** — $2/mo, the single largest avoidable item, and the
   easiest to get wrong because `fly launch` can assign a dedicated one
   silently.
2. **The machine actually sleeping** — the difference between $0.08 and
   $1.94/mo. `min_machines_running = 0` is set in `fly.toml`, but criterion 14
   verifies the *behaviour*, not the file.
3. **Volume stays at 1GB** — $0.15/GB/mo, and volumes cannot be shrunk. 259MB
   of data today; revisit only past ~700MB (D3).
4. **A manual month-to-date check** — since no alert exists, criterion 15 makes
   looking at the dashboard an explicit step rather than a good intention.

## 6. How do we know it is done?

Every one is a command or an observation, not a judgement.

1. `docker build -t spanish-srs .` succeeds from a clean checkout.
2. `npm run test -w server` passes, including **two new tests**: the sentinel
   refuses a `cards.json` that parses to `[]` and one that is absent, and
   boots with `ALLOW_EMPTY_STORE=1`.
3. **Deterministic flush test** (replaces revision 1's unfalsifiable criterion
   8, C3): a server test builds `new FileStore(tmp, { debounceMs: 60_000 })`,
   calls `saveCardsSoon()`, asserts the file is unchanged, calls `flushAll()`,
   asserts it is written. Must fail if `flushAll()` is stubbed out.
4. The built image, run locally with `DATA_DIR` pointed at a **copy** of
   `data/spanish/` and credentials set (note: use `AUTH_USER`, not `$USER` —
   the shell already populates that, C11):
   - `curl -i localhost:3000/api/collection` → `401`
   - `curl -i -u "$AUTH_USER:$AUTH_PASSWORD" localhost:3000/api/collection` →
     `200`, non-empty `cards`
   - `curl -i -u "$AUTH_USER:$AUTH_PASSWORD" localhost:3000/` → `200` + HTML
     (proves D8's layout)
5. The same image against an **empty** `DATA_DIR`, no `ALLOW_EMPTY_STORE`:
   exits non-zero, prints the path examined. With the flag: boots.
6. `fly deploy` succeeds; `https://<app>.fly.dev/` prompts for Basic auth.
7. Phase 0's `specs/archive/2026-08-27-013-server-hardening/verify.sh` passes
   against the public hostname (C7), plus `curl -i http://<app>.fly.dev/` →
   `308`.
8. **Redeploy preserves state, with a write in flight** (C11): answer a card,
   then immediately `fly deploy`; afterwards the deck list shows the expected
   due counts and the answered card did not return.
9. `fly secrets list` shows `AUTH_USER` + `AUTH_PASSWORD`; the deployed env
   shows **both** `ALLOW_EMPTY_STORE` and `DEV_MODE` absent.
10. On a phone, **on cellular with wifi off**, against **disposable state**
    (scratch volume or a `DATA_DIR` that will be wiped and re-seeded, C4):
    log in, study ≥20 cards, confirm audio plays, reload mid-session and
    confirm answered cards did not come back. Then wipe and re-seed.
11. **Backup round-trip** (D0): the pull script fetches the seven state files
    to the desktop; `git status` shows them changed; restoring them into a
    scratch `DATA_DIR` boots a server and one card can be studied against it.
12. **Shared IPv4, not dedicated** (D10): `fly ips list` shows no dedicated v4
    — the $2/mo line item that would otherwise exceed every other cost in this
    deployment combined.
13. **Runtime image is lean** (D11): `docker images spanish-srs` reports under
    **350MB**. The full `node_modules` is 287MB, so anything near 500MB means
    devDependencies were shipped.
14. **The machine actually sleeps**: after ~10 minutes idle,
    `fly machine list` shows state `stopped`; the next request auto-starts it.
    This is the difference between ~$0.08/mo and $1.94/mo, and until now only
    the *file* said so.
15. **Month-to-date bill checked by hand**: Fly has no billing alerts, so the
    dashboard's "current month to date" figure is read and recorded once the
    deployment has been live a few days. A number materially above
    ~$0.50/month means something in §5a is wrong.
16. `specs/011-mobile-remote-access/ROADMAP.md` Phase 1 checkboxes ticked,
    Phase 2's source-of-truth bullet marked decided (D0), and anything the
    phone pass revealed appended to that doc's `## Discovered` log.

### On the 20-card figure

Revision 1 justified dropping the roadmap's 200-card criterion to 20 as a
safety measure. That was backwards (C4): 20 carries the same *class* of risk
as 200. The real mitigation is criterion 10's disposable state. 20 is simply a
**smoke test sample size** — enough to prove the round-trip, small enough to
be quick. The 200-card session remains Phase 3's criterion, where the outbox
makes it meaningful.

## 7. Discovered (record, do not fix here)

- **C8** — `app.ts:70-78`: the tier-1 limiter (20 failures / 15 min) applies
  to *all* routes. An Angular page load 401s several times before credentials
  are entered; two mistyped passwords plus a few missing-media 404s can burn
  20 and lock the app out for 15 minutes — during criterion 10, which checks
  audio. Add a pre-phone check that media file count matches the desktop, and
  expect the lockout rather than misdiagnosing it.
- **C9** — `routes/index.ts:116-123`: `/review` calls `saveCardsSoon()`
  (debounced) but `await store.appendRevlog(...)` (immediate). A hard kill
  inside the window leaves the revlog claiming a review `cards.json` does not
  reflect. Not introduced here, but Fly's auto-stop makes it reachable for the
  first time, and it is exactly the divergence Phase 2's "rebuild from revlog"
  note assumes.
- **C11** — `server/src/index.ts:18` hardcodes `new FileStore(dataDir())`, so
  `debounceMs` cannot be tuned by env in production. Fine today; worth knowing.

## 8. Prerequisites outside the repo

- Fly.io account with a card on file — **done** (`jack.r.hendry.p@gmail.com`,
  org `personal`).
- `flyctl` installed and authenticated — **done** (v0.4.104).
- A local Docker runtime for criteria 1, 4 and 5 — **OrbStack chosen, install
  pending**: `brew install orbstack`.

## Retrospective

_(filled in 2026-09-17, after Step 21)_

### Outcome

Live at `https://spanish-srs.fly.dev` since 2026-09-16, in real use since
2026-09-17. Both non-negotiables hold: **hardening** (Step 17 — a 16-check
matrix against the public hostname, everything unauthenticated 401) and
**review persistence** (Step 20 — a card answered, then `fly deploy`, survived;
Step 21 — 12 cards on a phone over cellular, verified per-card in the store).
22 steps, 4 of which needed a second pass.

### Did Analyst.md catch anything not thought about up front?

Yes, three things, and all three would have been expensive later:

- **D8 (the layout invariant).** `config.ts`/`paths.ts` derive `repoRoot` by
  walking two levels up from the compiled JS, so a conventional flattening
  `COPY` in the runtime stage yields `staticDir: null` — an app that serves
  `/api` perfectly and 404s every page. Worth noting the failure is *silent and
  asymmetric*: every API check passes.
- **D10 (dedicated IPv4).** $2/mo, more than every other line item combined,
  allocated without asking by `fly launch`. Step 14 pre-allocated a **shared**
  v4 so the deploy had nothing to allocate — turning a check-and-remediate into
  a can't-happen.
- **D11 (production-only install).** The first Dockerfile draft ran an unscoped
  `npm ci --omit=dev`, which would have shipped Angular anyway: `@angular/*`,
  `rxjs` and `tslib` are production **`dependencies`** of the `web` workspace.
  `--omit=dev` does not mean "no frontend".

### Did anything in tasks.md turn out to be wrong during coding?

**The recurring defect was the un-failable acceptance criterion — five
instances, and it is this spec's main export (L-019).** Steps 4, 7, 12, 15 and
16 each shipped a `Done when` that would have passed whether or not the thing
under test worked: an mtime comparison that reads identical either way; a curl
that hit the developer's dev server instead of the container; a `bash -n` over a
script whose every remote call used a nonexistent subcommand; an `ls | wc -l`
that cannot see dotfiles; a `grep -c → 0` over a stream that might be empty.
Four were caught only because a later step looked again.

Also wrong:

- **Step 3's `Done when` was a test count, and vitest transpiles without
  typechecking** — so 79 tests passed over code that did not compile
  (`tsc` exit 2, two `ServerConfig` literals). Caught at Step 5. Any step that
  widens a shared interface needs `npm run build` in its *own* criteria. This is
  L-003 recurring, which suggests the lesson needs to reach the task template,
  not just the lessons file.
- **Step 7's <350MB image gate looked unreachable** and was nearly waived: the
  arm64 base alone is 349MB. But Fly's remote builder is **amd64**, where the
  image is **73MB** as deployed. The gate was being measured against the wrong
  architecture, not set too tight.
- **Step 17's `http://` → 308 criterion was simply wrong.** Fly's edge answers
  **301** before the request reaches the machine. Step 10 predicted this
  precisely. Amended the criterion, not the code.
- **Two harness denials with no planned fallback** (L-022): `fly secrets set` is
  denied as a class, and the delegation hook and permission classifier
  deadlocked Step 20 between them.

### What changed from the plan

- **D0 was resolved here rather than deferred to Phase 2** — the seed and
  restore scripts could not be written without knowing which side wins. Became
  AD-025.
- **Step 21's restore (item 6) was dropped** by the user's decision, once the
  phone reviews became real study rather than a throwaway sample. **Cost: the
  push path has still never run against production.** Recorded in the ROADMAP.
- **Step 21 ran 12 cards, not ~20** (itself already reduced from the roadmap's
  200). The step's own reasoning covers it — the safety property is the verified
  restore, not the sample size.
- **Steps 17 and 20 became `top-level`**, both because the credential must not
  enter a subagent transcript.

### Cost baseline (2026-09-17)

Fly has **no billing alerts and no hard spending limit** — "We don't support
billing alerts (yet), so budget accordingly" — so this record *is* the
mechanism. `flyctl` exposes no billing subcommand; the month-to-date figure has
to be read from the dashboard.

```
$ fly ips list
v4  66.241.124.151  public ingress (shared)        ← no dedicated v4 ($2/mo avoided)

$ fly volumes list
vol_vjyq28pjgdn335xv  created  spanish_data  1GB  yyz  encrypted  261M/974M used

$ fly machine list
850d53cd95d668  young-dream-3731  stopped  shared-cpu-1x:256MB  yyz
```

Expected steady state, from measured behaviour rather than assumption:

| line item | basis | /mo |
|---|---|---|
| compute | machine confirmed `stopped` after ~7 min idle (Step 19); occasional use | ~$0.08 |
| volume | 1GB × $0.15/GB | $0.15 |
| shared IPv4 | free | $0.00 |
| bandwidth | ~5MB state, media cached | ~$0.00 |
| **total** | | **$0.25–$0.50** |

The always-on branch ($1.94/mo compute) is **ruled out by measurement**, not
assumed away: Step 19 watched the machine stop and cold-start in 5.1s, and
confirmed a `[[http_service.checks]]` health check does not hold it awake.

**⚠️ Two follow-ups for the user:** the dashboard's *current month to date*
figure has not been read and is the one number this table cannot produce —
re-check in a week at `https://fly.io/dashboard/personal/billing`. A figure
materially above $0.50 means something in §5a is wrong; the first suspects are a
dedicated IPv4 having appeared and the machine no longer sleeping.
