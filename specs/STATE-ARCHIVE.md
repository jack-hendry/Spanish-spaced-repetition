# STATE — archive

Overflow for `STATE.md`. When that file gets unwieldy (~300 lines), old
`AD` (decisions) and `B` (blockers) entries and closed Quick Tasks move here.
`python3 tools/state_rotate.py --apply` does the move; the pre-push hook only
ever runs `--check`.

Rules:

- **Lessons (`L-NNN`) never move here.** They are permanent and stay in
  `STATE.md`.
- Numbers are preserved exactly — moving an entry never renumbers it.
- A moved entry leaves a one-line stub in `STATE.md` pointing here, so a
  citation like "supersedes AD-004" is always resolvable.
- Superseded decisions are moved here, not deleted. The reasoning that turned
  out to be wrong is the most useful part of the record.

## Decisions

(nothing rotated yet)

**AD-007 — `todayNumber` may be changed by 010, and its ≤1-day transition is
accepted, never migrated.** (2026-08-15, `specs/010-day-rollover-anchoring`)
007 explicitly deferred the root cause and declared changing `todayNumber`
a non-goal; 010 reverses that for this one feature. Day numbers exist in two
populations with different lifetimes — **derived at render time** from epoch-ms
(streaks, forecasts, heat, optimizer histories; these self-correct) and
**persisted** (`card.due` for review cards, `deck.daily.day`,
`collection.lastUnburyDay`; these do not). The correction comes solely from
moving where the boundaries fall. No step may re-base the persisted set, and no
artificial origin offset may be added to keep today's integer at 51 — that
would preserve the stale `deck.daily.day` match and leave the reported bug
unfixed.

**AD-008 — `specs/STATE.md` is the project memory; root `STATE.md` is a run
marker only.** (2026-08-26, migration) Two files named STATE.md is a real cost,
paid deliberately: the root one exists because
`.claude/hooks/enforce-haiku-tasks-pretooluse.sh` greps the **repo root** for
`## Executing: <spec-dir-name>`, and a hook that greps project memory would fire
on any incidental mention. Keeping the marker in a file with nothing else in it
is what makes the signal unambiguous. See **L-004**, **L-005**.

**AD-009 — Adopted habit_tracker's harness shape; retired the `/feature` +
`/resume` pipeline.** (2026-08-26) The old harness used `specs/NNN-slug/` with
`SPEC`/`PLAN`/`STATE`/`CRITIQUE.md`, four subagents, two slash commands and one
Stop hook, and routed models by a planner-assigned `Complexity:` rating. It is
replaced by: `Analyst.md` / `tasks.md` / `CriticReview.md` per
`specs/<feature-name>/`; a repo-wide `specs/STATE.md` + `specs/LESSONS.md` +
`specs/STATE-ARCHIVE.md`; per-step `Model:` fields (`haiku` / `sonnet` /
`top-level`, **never `opus`**); two PreToolUse hooks and one UserPromptSubmit
hook; and a `clean-table-check.sh` pre-push gate mirrored in CI. Why: the
enforcement layer is the part the old harness lacked entirely — its single Stop
hook asked for a STATE.md update and nothing checked archives, lesson
correspondence, memory size, or who was allowed to write what. The top-level
session now orchestrates directly; the `Model:` field replaces `resume.md`'s
complexity routing, and putting it *in the step* makes an absent one a visible
defect rather than a silent inherit of the session model. Cost, accepted: the
nine archived specs keep the old filenames (see Quick Tasks).

**AD-010 — A stale persisted `card.left` is clamped once, at the source, by one
shared helper — not guarded at each call site.** (2026-08-26,
`specs/012-clamp-learning-steps-nan-due`, from audit B1) `card.left` is
persisted; the steps array it indexes comes from deck options the user can edit,
so shortening that array left `card.left > steps.length` and the `good` branch
of all four `previewLearning`/`previewRelearning` functions read `steps[-1]` →
`undefined * 60_000` → `due: NaN`. The fix is `clampLeft(left, stepCount)` in
`web/src/app/core/scheduling/learning-steps.ts`, called at exactly the four
points where `curLeft` is first derived from `card.left` (`sm2.ts` ×2,
`fsrs.ts` ×2). Clamping into `[1, stepCount]` makes every downstream
`steps[...]` index valid *by construction*, so no second, downstream clamp is
added and `StudyQueueService` needs no change. **Why one shared helper rather
than four inline `Math.min`/`Math.max` expressions:** the audit found this bug
duplicated verbatim across `sm2.ts` and `fsrs.ts` — which is what you get when
one is written by copying the other. Four inline clamps would have re-created
exactly the condition that produced the bug. The *why* now lives in one doc
comment, in one place. Accepted residual risk: nothing forces a future fifth
`previewX` to call it, and the helper's unstated precondition is
`stepCount >= 1` (guaranteed today by the `steps.length ? … : [1]` guard at each
call site). See the `scheduling-domain` skill's 2026-08-26 lesson.

**AD-011 — Hardening is the default; `DEV_MODE=1` is the only opt-out.**
(2026-08-27, `specs/013-server-hardening`, D2) Supersedes the usual
`NODE_ENV === 'production'` shape, which was the spec's first proposal. Under
`NODE_ENV`, a *forgotten* environment variable yields the **insecure** state —
the exact failure this spec exists to prevent, and one that boots
"successfully" so nothing surfaces it. Inverting it means a forgotten variable
yields the secure state, and the insecure mode requires someone to have asked
for it by name. The second-order benefit is the one that actually decided it:
the hardened path is now what runs by default, so **the default is what gets
tested**. `server/src/config.ts` therefore contains no `NODE_ENV` branch at all,
and the step's "Done when" greps for exactly that (`grep -c NODE_ENV` → `0`) so
the old shape cannot creep back in later.

**AD-012 — A hardened server with no credentials refuses to boot.**
(2026-08-27, `specs/013-server-hardening`, D3) `loadConfig` throws `ConfigError`
when hardened and `AUTH_USER`/`AUTH_PASSWORD` are not both set; `index.ts`
catches it, logs `refusing to start: …` and exits 1. The two rejected
alternatives fail in the same way: serving unauthenticated *is* the breach, and
generating a random password nobody knows produces a machine that is up but
unreachable. A misconfiguration should be a **failed boot, not a silently wrong
one** — the same shape as the Phase 1 empty-volume sentinel.

**AD-013 — `express.json` is mounted *after* auth, deliberately.**
(2026-08-27, `specs/013-server-hardening`, §2.3) Order in `server/src/app.ts` is
`trust proxy → forceHttps → helmet → rate limit → basicAuth → express.json →
routes`. With the body parser after auth, an unauthenticated request never has
its body parsed at all, which is what demotes the body-size limit from a
security control to a tuning decision. That ordering is the substantive content
of the file and prose alone would not survive a refactor, so the step pins it
with a `grep -n` that must print `basicAuth` < `express.json` <
`app.use('/api'` in strictly increasing line order. Two more things there look
like bugs and are not: `trust proxy` is `1`, not `true` (express-rate-limit
rejects a permissive setting with `ERR_ERL_PERMISSIVE_TRUST_PROXY`, since it
would let a client spoof its IP and defeat the limiter), and the HTTPS redirect
exempts loopback — without which every local verification command gets a 308.

## Blockers

(nothing rotated yet)

## Quick Tasks

(nothing rotated yet)
