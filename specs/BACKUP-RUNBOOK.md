# Backup runbook — the `FLY_API_TOKEN` credential

Operator-facing, like `specs/SESSION-HYGIENE.md`: a reference for the human,
deliberately **not** linked from `CLAUDE.md` so it costs nothing per turn
(L-017). The place you land from is the header comment in
`.github/workflows/backup.yml`.

> **STATUS — 2026-09-18: LIVE.** `.github/workflows/backup.yml` runs
> `0 */6 * * *` against `spanish-srs` using the `FLY_API_TOKEN` repository
> secret. Proven by `specs/022-backup-and-restore/`: the first successful
> **scheduled** (not dispatched) run was
> [35337739105](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35337739105)
> on 2026-09-18, and it produced the backup commit `eff78ca`. A failing pull
> has been shown to fail the run
> ([35277152866](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35277152866)),
> and a no-op run has been shown to commit nothing
> ([35275578508](https://github.com/jack-hendry/Spanish-spaced-repetition/actions/runs/35275578508)).
>
> **The restore path works, and has been proven at production scale.**
> `tools/push-fly-state.sh --yes` restored all 7 state files (3,638 notes /
> 7,276 cards / 3,915 revlog lines) into a throwaway Fly app, every deck /
> note / card / queue / type count matched production's recorded numbers, and
> **one card was studied against the restored app** — so the restore is
> writable, not merely readable. The `local`-outside-a-function bug that made
> this path fatally broken, while a roadmap recorded it as already exercised,
> is fixed; see **L-025**.

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

**RESOLVED 2026-09-18 — the answer was no, and the *workflow* changed rather
than the token.** An `ssh`-scoped token **cannot** run `fly machine start` or
`fly machine stop`: both require a machine *lease*, and both fail
`failed to obtain lease: … unauthorized` while `fly machine list` succeeds with
the same token in the same job. Rather than widen the credential to a `deploy`
or `org` token, the workflow dropped the requirement — it wakes the machine
with `curl -f https://spanish-srs.fly.dev/api/health` (anonymous by design, and
`fly.toml` sets `auto_start_machines = true` / `min_machines_running = 0`) and
has **no stop step at all**, relying on Fly's auto-stop to reclaim it (measured
at 539s and 413s on two separate occasions). See **AD-028** and **L-026**.

**The token in use is `ssh`** — the narrowest of the four types, holding no
machine permission at all. That is the durable security fact this section asked
to record: a leak of this credential cannot start, stop or destroy the machine.
What it can do is SSH to `spanish-srs` and reach the org's WireGuard network.

**If the token leaks**, the realistic harm is not disclosure — it is Spanish
flashcard scheduling. It is **destruction**. The shape of that risk narrowed
once the token was confirmed `ssh`-scoped (above): it cannot reach the machine
or volume management APIs, so `fly volumes destroy` is out of its reach. What
it *can* do is SSH into the running app — and the app writes the volume, so the
state files can still be corrupted or deleted from the inside. The saving grace
is circular but real: the backup this token powers is exactly what makes that
survivable.

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
under 30 days, converting a silent stop into a loud one.

**STILL UNVERIFIED as of 2026-09-18, and deliberately recorded as such.** Spec
022 never settled whether an `ssh`-scoped token may call `fly tokens list`,
because it could not: the token's value exists only inside the GitHub secret
and is never readable from a developer machine — it was piped straight from
`fly tokens create` into `gh secret set` precisely so no copy would exist. The
cheap way to settle it is to add a throwaway `fly tokens list --app spanish-srs`
step to `backup.yml`, dispatch once, read the log, and delete the step. Until
someone does that this is an idea, not a plan — and the **calendar reminder,
not this, remains the load-bearing mitigation** for expiry.

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

> 🔴 **OUTSTANDING as of 2026-09-18 — an orphan token is still live.**
> `fly tokens list --app spanish-srs` shows **two** unrevoked `flyctl ssh
> token` rows created ~49s apart. The secret's `updatedAt` matches
> `0wj3jnOmeL…`, so `MAwawkKV1G…` is an orphan: a live credential with no known
> consumer, which is leak surface with no compensating benefit. The user
> decided on 2026-09-17 to revoke it once Step 7 was green; Step 7 went green
> that day and the revoke was never run. To close it:
>
> ```sh
> fly tokens revoke MAwawkKV1GzBKSw39n5OJ19lpeCzpQX3m5pqwb1T8k
> fly tokens list --app spanish-srs   # expect exactly one empty REVOKED AT
> gh workflow run backup.yml          # confirm the backup still passes
> ```
>
> If the backup goes red afterwards, the secret held the *other* token: rotate
> per the procedure above. That is the only reason to fear this revoke, and it
> is cheap to undo.

### Check the backup is actually running

```sh
gh run list --workflow=backup.yml --limit 10
git log -1 --format='%ci %s' -- data/spanish/cards.json
```

A green run history with no recent `data/spanish/` commit is **normal** — a
no-op run deliberately commits nothing when no cards were studied. The signal
to worry about is no *runs*, not no commits.

### Restore from the repo back to Fly

⚠️ Overwrites the live volume. Requires `--yes`. **Proven at production scale
2026-09-17** (spec 022 Steps 12–15) — but against a *throwaway* app. Production
has still never been restored over.

Note the asymmetry that makes a dry run weak evidence here: the `--yes` path and
the dry-run path **diverge**, and for months only the dry-run path worked at
all. A clean dry run tells you the plan is right; it does not tell you the
upload works.

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

Fly snapshot status, **measured not assumed**. 2026-09-17:
`Scheduled snapshots: true`, `Snapshot retention: 5`, and **zero snapshots
existed** — the volume was 18 hours old, which is why the roadmap's claim that
snapshots were "unconfigured" was wrong on configuration and right on outcome.
2026-09-18: **exactly one** snapshot (`vs_yeo71KGwpvPXTKZ25653LKp7`, 345 MiB).

So read the "5 days" in the table above as a **retention setting, not a
rollback depth**. The real depth is the age of the oldest snapshot that
actually exists — currently under a day. It grows toward 5 days as snapshots
accumulate; it is not there yet, and nothing warns you if they silently stop
being taken. Re-check with:

```sh
fly volumes show vol_vjyq28pjgdn335xv
fly volumes snapshots list vol_vjyq28pjgdn335xv
```

## Related

- `specs/022-backup-and-restore/` — the spec building this (Analyst D5–D7, S6)
- `specs/011-mobile-remote-access/ROADMAP.md` — Phase 2, and Phase 3 for the
  in-flight gap this cannot cover
- `AD-025` (Fly-as-source), `AD-026` (empty-store sentinel), `AD-027`
  (retention: three layers, and the cron interval *is* the loss window),
  `AD-028` (HTTP wake, CI token holds no machine permission) in
  `specs/STATE.md`
- `L-025` (a spec's past-tense claim is a hypothesis), `L-026` (a credential
  that authenticates is not one that can act) in `specs/LESSONS.md`
