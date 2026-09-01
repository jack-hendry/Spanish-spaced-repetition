# Session hygiene — where the tokens actually go

Operator reference: written for the human, not loaded into any session's
context. Read it when you want a session to cost less, or when
`tools/session_report.py` shows a number you don't like. The findings behind it
are **L-017**.

## The one fact everything else follows from

Across this repo's transcripts: **284.9M input tokens against 1.3M of output.
99.5% of everything spent is the conversation being re-sent, turn after turn.**

A task is not expensive because it is big. It is expensive because of *where it
sits*. An `ls` at turn 2 that dumps 8k tokens is not an 8k mistake — every turn
after it re-reads those 8k, so it really cost 2.3M. That is **carry cost**, and
it is the number worth ranking by.

## Do

| Do | Why |
|---|---|
| `/clear` at every spec boundary and after any break over a few hours | The only lever here that is arithmetic rather than persuasion. Worked example below. |
| Pipe bulk output — `head`, `wc -l`, `grep -c`, one `--json` field — before it lands | 19 turns that each added ≥3k carried 19.3M between them: 27% of one session's input. |
| Finish a thought before walking away | An idle gap past the 1h cache TTL re-primes the whole context at *creation* rates, billed dearer than read. One session did this 4 times for 1.1M tokens. |
| Re-measure after changing a habit | Claims about this are cheap. `tools/session_report.py` is what makes them falsifiable — including mine. |

## Don't

| Don't | Why |
|---|---|
| Trim `CLAUDE.md` to save tokens | It is ~4.2k of a ~47k floor — 9%. Deleting the whole file recovers under 2% of a session. |
| Chase the "fixed floor" figure in the report | Floor × turns is a tax you cannot avoid: a cleared session still re-reads its floor every turn. The addressable spend is everything *above* the floor. |
| Compare `mean ctx` across different kinds of work | It tracks task length far more than hygiene. Compare like with like — the lint phases 017–020 were near-identical tasks and are this repo's natural control group. |
| Add an instruction telling the model to batch its tool calls | The system prompt already says it, and batching *decays within a session* (below) — so more instruction text, re-read inside the very context causing the decay, is the least likely thing to fix it. |

## When to `/clear`, and the example that produced the rule

Session `29500212` was **four prompts across 3.5 days** and 291 turns, spanning
specs 015, 017, 018 and part of 019:

    2026-08-28 21:28  "…ROADMAP.md Lets start work for phase 1"
    2026-08-28 22:45  "Continue"                                       (1.3h gap)
    2026-08-29 20:33  "If everything is done, can we push and raise a PR"  (21.6h)
    2026-08-31 10:20  "I have merged and closed the PR"                (37.8h)

What each missed `/clear` cost. Rows overlap — clearing early subsumes the later
ones — and "if cleared" models regrowth at the session's own average rate, so
treat that column as an estimate, not a measurement:

    gap at turn    idle   ctx then   turns after   carried   if cleared   saved
            36     1.1h       121k           255     69.4M        29.5M   39.8M
           194     1.4h       301k            97     34.3M        10.6M   23.6M
           229    18.7h       343k            62     23.0M         5.3M   17.7M
           282    37.6h       358k             9      3.2M         0.5M    2.8M

The last row needs no model to believe: after *"I have merged and closed the
PR"*, nine turns of post-merge work each carried 358k of dead phase-1 lint
context. Nothing about a merged PR needs the file-by-file fixes from three days
earlier.

> **Rule:** clear after the end-of-feature ritual, after a PR merges, and when
> you come back the next morning.

## Batching decays as a session grows

First third vs last third of every session over 60 turns:

    session    turns  first 3rd  last 3rd
    06eb0b1d     149        17%        3%
    29500212     291         9%        0%
    61279fa7     133        36%       14%
    644e4c6f      82        11%        0%
    7ab2ff8c      67        26%       10%
    63441293     161         0%        0%
    8bf8c866     181         0%        0%
    b40fa71a     214         0%        0%

    41 batched turns across the first thirds; 8 across the last thirds,
    over comparable call counts (403 vs 378 tool-calling turns).

Every session that batches at all declines. Task mix explains part of the
*between*-session spread (Pearson r = −0.42 against edit+write share) but cannot
explain a monotonic *within*-session decline in 6 of 6. So the remedy is shorter
sessions, not more instructions — the same lever as above.

## Recording (automatic)

A `SessionEnd` hook in `.claude/settings.local.json` (gitignored — personal, not
a project contract) appends one compact JSON line per session to
`~/.claude/token-logs/spanish-srs.ndjson`. It runs outside the model's context,
so it costs **zero tokens**, and it exists because transcripts are deleted after
`cleanupPeriodDays` (30 by default) — without it, today's baseline is
unreproducible next month.

It only fires on a *clean* session exit; a killed terminal writes nothing. So
the same command doubles as a backfill, and is safe to re-run at any time:

```bash
python3 tools/session_report.py --append-log ~/.claude/token-logs/spanish-srs.ndjson
```

Reading the trend:

```bash
# newest 10 sessions: turns, mean context, re-primes, fat-payload %, batch %
jq -r '[.start,.turns,.mean_context,.reprimes,.fat_payload_share,.batch_rate]|@tsv' \
  ~/.claude/token-logs/spanish-srs.ndjson | tail -10

# are re-primes going away? (the /clear habit working)
jq -s 'group_by(.start[0:7])[]|{month:.[0].start[0:7],sessions:length,
  reprimes:(map(.reprimes)|add)}' ~/.claude/token-logs/spanish-srs.ndjson
```

## Measuring

```bash
python3 tools/session_report.py                    # every session, biggest first
python3 tools/session_report.py --top 5            # detail the 5 biggest
python3 tools/session_report.py --session b40fa71a # drill into one
python3 tools/session_report.py --json > baseline.json
```

Three numbers to watch on a new session: **re-primes** (target 0), **fat-payload
%**, **batch %**. Ignore `mean ctx` unless you are comparing like work.
