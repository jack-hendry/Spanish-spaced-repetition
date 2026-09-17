# Backup runbook — the `FLY_API_TOKEN` credential

Operator-facing, like `specs/SESSION-HYGIENE.md`: a reference for the human,
deliberately **not** linked from `CLAUDE.md` so it costs nothing per turn
(L-017). The place you land from is the header comment in
`.github/workflows/backup.yml`.

> **STATUS — 2026-09-17: not yet live.** The token and the workflow this
> describes are being built in `specs/022-backup-and-restore/`. Steps 5–7 are
> what make this document true. Until then, read it as the intended design,
> and treat every claim marked **UNVERIFIED** as a hypothesis.
>
> **The restore path is currently broken** — `tools/push-fly-state.sh --yes`
> aborts before uploading anything (`local` used outside a function, fatal
> under `set -euo pipefail`). Spec Step 1 fixes it, Step 13 proves it. Do not
> rely on a restore until then.

---

## What the credential is for

`FLY_API_TOKEN` is a GitHub Actions **repository secret** on
`jack-hendry/Spanish-spaced-repetition`. One thing uses it: the scheduled
backup workflow, which every 6 hours copies the seven scheduling-state files
off the Fly volume and into this repo.

It exists because of `AD-025`: **Fly is the source of truth for scheduling
state, and the repo is a lagging replica.** The Fly volume is a single copy
on a single host — that is not a backup. This token is what lets an automated
job pull that copy somewhere else.

```
fly machine start  →  tools/pull-fly-state.sh  →  commit if changed  →  fly machine stop
```

The `fly machine start` is **mandatory, not an optimisation**: `fly ssh` does
not wake a sleeping machine, it just fails with `no started VMs`. With
auto-stop and `min_machines_running = 0`, a scheduled job finds the machine
asleep essentially every time.

## What it protects, and what it does not

**Protects:** the seven state files — `collection.json`, `notetypes.json`,
`decks.json`, `deckoptions.json`, `notes.json`, `cards.json`,
`revlog.ndjson`. About 6MB. `cards.json` + `revlog.ndjson` are the
irreplaceable part: content can be re-scraped, review history cannot.

**Does not protect:**

- **`media/`** — 252MB, gitignored, regenerable via `tools/convert_apkg.py`.
  Deliberately excluded.
- **A review lost in flight.** If the phone never successfully POSTs a
  review, it never reaches Fly, so no backup interval can recover it. That is
  Phase 3 in `specs/011-mobile-remote-access/ROADMAP.md` and is the larger
  residual risk.
- **Anything in the last ≤6 hours.** The cadence is the loss window.

### Is a 6-hour window enough?

Measured from the live revlog (2026-09-17): **30 active study days in the 73
days since 2026-07-06**, median **118** reviews on a day you study, maximum
**263**. So a worst-case loss is a fraction of one session — and "loss" means
those cards revert to their prior due state and get re-reviewed. Nothing is
corrupted; notes and decks are untouched.

## What the token can do (blast radius)

Verified from `fly tokens create --help`:

| Type | Scope |
|---|---|
| `ssh` | SSH to a **single app** — *and* connect to the org's WireGuard network |
| `deploy` | A single app and its resources |
| `org` | The whole org |
| `readonly` | Read-only over the whole org |

The intended token is **`ssh`**, the narrowest that plausibly works. The
WireGuard grant reads alarmingly but is near-empty here: the `personal` org
contains **exactly one app** (`spanish-srs`), so there is nowhere to move
laterally.

**UNVERIFIED:** whether an `ssh`-scoped token can also run
`fly machine start` / `stop`, which the workflow needs. If it cannot, the
fallback is a `deploy` token — still app-scoped. Spec Step 7 answers this
empirically. **Record which type was actually used**; it is a durable
security fact.

**If the token leaks**, the realistic harm is not disclosure — it is Spanish
flashcard scheduling. It is **destruction**: a token that can manage the app
can destroy the volume. The saving grace is circular but real — the backup
this token powers is exactly what makes that survivable.

## Where the dates live — query them, never copy them

**There is no file recording when the token was created or when it expires,
and that is deliberate.** Both facts are owned by the systems that issued
them:

| Fact | Command |
|---|---|
| Expiry | `fly tokens list --app spanish-srs` → `EXPIRES AT` |
| Created / last rotated | `gh secret list --repo jack-hendry/Spanish-spaced-repetition --json name,updatedAt` |

Copying either into a file would be a hand-maintained duplicate of a fact the
system already owns — **L-009**: *"a hand-maintained pointer decays the moment
nobody is forced to touch it."* Rotate early and the copy silently lies,
which is worse than no date at all, because it will be believed.

`fly tokens list` also shows `REVOKED AT`, so it doubles as the check for
"is this credential still live?".

## The two ways this stops working silently

Neither is engineered away. Both are made visible.

**1. The token expires.** Chosen expiry is **1 year** (`--expiry 8760h`).
Fly's default is `175200h` — 20 years — so the flag must be passed
explicitly. A shorter expiry shrinks the leak window but *guarantees* an
eventual silent stop; that trade-off was made knowingly.

*How you find out:* a **calendar reminder ~3 weeks before expiry** — set
against the real date from `fly tokens list`, not an assumed one. This is the
load-bearing mitigation, because it is the only mechanism here that
interrupts a human unprompted. A queryable date is a lookup path, not a
safety net.

**2. GitHub auto-disables the workflow.** GitHub disables scheduled workflows
after **60 days of repository inactivity**. This interacts with the design
choice that a no-op run commits nothing: a study break longer than 60 days,
with no other pushes, could disable the backup.

*How you find out:* GitHub emails the repository owner when it disables a
scheduled workflow. That email is the signal — do not ignore it.

A third possibility worth knowing about: the workflow already runs every 6
hours holding the token, so it *could* self-check and warn when expiry is
under 30 days, converting a silent stop into a loud one. **UNVERIFIED** —
an `ssh`-scoped token may not be permitted to call `fly tokens list`.

## Procedures

### Create or rotate the token

Pipe it, so the value never renders in a terminal, a browser, or an agent
session transcript (`~/.claude/projects/…`, retained for `cleanupPeriodDays`
— a token printed there is a durable copy of a live credential):

```sh
fly tokens create ssh --app spanish-srs --expiry 8760h \
  | gh secret set FLY_API_TOKEN --repo jack-hendry/Spanish-spaced-repetition
```

Then confirm, and reset the calendar reminder against the new `EXPIRES AT`:

```sh
gh secret list --repo jack-hendry/Spanish-spaced-repetition
fly tokens list --app spanish-srs
```

Rotating does **not** revoke the old token. Revoke it explicitly (below).

### Revoke a token (suspected leak, or after rotating)

```sh
fly tokens list --app spanish-srs          # copy the ID
fly tokens revoke <ID>                      # accepts several IDs
```

After revoking the live token the backup stops working — rotate first, or
accept the gap and rotate immediately after.

### Check the backup is actually running

```sh
gh run list --workflow=backup.yml --limit 10
git log -1 --format='%ci %s' -- data/spanish/cards.json
```

A green run history with no recent `data/spanish/` commit is **normal** — a
no-op run deliberately commits nothing when no cards were studied. The signal
to worry about is no *runs*, not no commits.

### Restore from the repo back to Fly

⚠️ Overwrites the live volume. Requires `--yes`. See the status banner at the
top — **this path is broken until spec Step 1 lands.**

```sh
bash tools/push-fly-state.sh --yes data/spanish        # dry run without --yes
```

Deeper rollback: check out an older commit of `data/spanish/` first, then
push that. Git history is the unbounded rollback layer.

## The layers, and which failure each answers

| Layer | Answers | Limits |
|---|---|---|
| Fly volume | live state | single copy, single host — **not a backup** |
| Fly snapshots | fast rollback | **5 days**, on Fly only; useless if the account is lost |
| This repo (git) | deep rollback, off-Fly | lags by ≤6h; only as good as the workflow running |

Fly snapshot status as measured 2026-09-17: `Scheduled snapshots: true`,
`Snapshot retention: 5`, and **zero snapshots existed** — the volume was 18
hours old. Re-check with:

```sh
fly volumes show vol_vjyq28pjgdn335xv
fly volumes snapshots list vol_vjyq28pjgdn335xv
```

## Related

- `specs/022-backup-and-restore/` — the spec building this (Analyst D5–D7, S6)
- `specs/011-mobile-remote-access/ROADMAP.md` — Phase 2, and Phase 3 for the
  in-flight gap this cannot cover
- `AD-025` (Fly-as-source), `AD-026` (empty-store sentinel) in `specs/STATE.md`
