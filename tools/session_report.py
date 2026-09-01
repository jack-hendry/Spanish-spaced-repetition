#!/usr/bin/env python3
"""Attribute a Claude Code session's token spend to the things that caused it.

The motivating measurement (2026-08-31): across two real sessions in this repo,
**99.5% of all tokens were input re-reads** -- the accumulated transcript sent
again on every turn -- and only 0.5% was model output. One 491-turn session
re-read an average of 233k tokens per turn. Nothing about that is visible while
you work, which is why a small task late in a long session can cost more than a
large task early in one.

So the expensive thing is not what a tool call *does*, it is what a tool call
*leaves behind*, multiplied by how many turns follow it. This script measures
that directly and names the offenders.

The central metric is **carry cost**. Context size at any turn is exact and
already recorded -- `input_tokens + cache_read_input_tokens +
cache_creation_input_tokens` is precisely what that request paid for. The
difference between consecutive turns is what the intervening tool result and
assistant output added. A turn that adds D tokens at position i of an N-turn
session is re-read (N - i) more times, so it costs:

    carry = D * (N - i)

That is the honest price of a `git log` you did not pipe through `head`. No
character-counting estimates and no model in the loop: the reader is arithmetic
over numbers the transcript already stores.

Deliberately not an agent. A 2.8 MB transcript is roughly 700k tokens to feed to
a model, which is a preposterous way to discover that you should have piped
something through `head`. Measure with a script, and spend model attention only
on the report.

Reads the JSONL transcripts Claude Code writes to
~/.claude/projects/<munged-cwd>/. Never writes to them.

Usage:

    python3 tools/session_report.py                  # this repo, all sessions
    python3 tools/session_report.py --top 5          # five worst sessions
    python3 tools/session_report.py --session <id>   # drill into one
    python3 tools/session_report.py --json           # machine-readable
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

# Tool results below this many added tokens are noise; a turn's own text and
# thinking land in the same delta and are typically a few hundred tokens.
NOISE_FLOOR = 400

# Anything at or above this in a single turn is a payload that should probably
# have been filtered, paged, or pushed into a subagent.
FAT_RESULT = 3000

# A re-prime under this many minutes of idle is the cache warming up at the head
# of a session, not a break in the work; only the latter is worth acting on.
IDLE_MIN = 5


def project_dir(cwd: Path) -> Path:
    """Claude Code munges the cwd into a directory name by replacing / with -."""
    return Path.home() / ".claude" / "projects" / str(cwd).replace("/", "-")


def load_turns(path: Path) -> list[dict]:
    """Return the assistant turns of a transcript, in order, with usage attached.

    Only assistant messages carry a usage block, and each one is a request whose
    input *is* the whole context at that moment -- which makes the sequence of
    assistant turns the sampling grid for everything below. Non-message records
    (metadata, attachments) are skipped here but their cost is not lost: they
    inflate the next turn's context and therefore show up in its delta.
    """
    # A single assistant message is written to the transcript as SEVERAL
    # records -- one per content block, each repeating the same `message.id`,
    # `requestId` and usage. Counting records therefore counts blocks, not
    # turns: it inflates the turn count and makes parallel tool calls
    # structurally invisible, because no single record ever holds two
    # `tool_use` blocks. Group by message id first; everything downstream
    # depends on a turn being one request.
    groups: dict[str, dict] = {}
    order: list[str] = []
    with path.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("type") != "assistant":
                continue
            msg = rec.get("message") or {}
            # `<synthetic>` turns are harness-generated (interrupts, errors) and
            # carry a zeroed usage block. Left in, their zero context reads as a
            # context collapse and the next real turn looks like it added the
            # entire session in one go.
            if msg.get("model") == "<synthetic>":
                continue
            key = msg.get("id") or rec.get("requestId") or rec.get("uuid")
            if key not in groups:
                groups[key] = {"ts": rec.get("timestamp", ""), "usage": None, "content": []}
                order.append(key)
            g = groups[key]
            g["content"].extend(c for c in (msg.get("content") or []) if isinstance(c, dict))
            if msg.get("usage") and not g["usage"]:
                g["usage"] = msg["usage"]

    turns = []
    for key in order:
        g = groups[key]
        usage = g["usage"]
        if not usage:
            continue
        content = g["content"]
        tools = [c.get("name") for c in content if c.get("type") == "tool_use"]
        turns.append(
            {
                "ts": g["ts"],
                "context": (
                    usage.get("input_tokens", 0)
                    + usage.get("cache_read_input_tokens", 0)
                    + usage.get("cache_creation_input_tokens", 0)
                ),
                "read": usage.get("cache_read_input_tokens", 0),
                "created": usage.get("cache_creation_input_tokens", 0),
                "output": usage.get("output_tokens", 0),
                "thinking": (usage.get("output_tokens_details") or {}).get("thinking_tokens", 0),
                "tools": tools,
                "commands": [
                    c.get("input", {}).get("command", "")
                    for c in content
                    if c.get("type") == "tool_use" and c.get("name") == "Bash"
                ],
            }
        )
    return turns


def fingerprint(cmd: str) -> str:
    """Collapse a shell command to its recurring shape.

    Absolute paths, hashes and numbers are the parts that differ between two
    runs of the same habit, so they are exactly what has to go before the habit
    becomes countable. A heredoc body is squashed whole: an inline script that
    shows up repeatedly is the single strongest signal that something wanted to
    be a file in tools/ and never got promoted.
    """
    cmd = re.sub(r"<<'?(\w+)'?.*?\n\1", "<<HEREDOC>>", cmd, flags=re.S)
    cmd = re.sub(r"/[\w./-]{12,}", "PATH", cmd)
    cmd = re.sub(r"\b[0-9a-f]{7,}\b", "HASH", cmd)
    cmd = re.sub(r"\b\d+\b", "N", cmd)
    cmd = re.sub(r"\s+", " ", cmd).strip()
    return cmd[:100]


def analyse(path: Path) -> dict | None:
    turns = load_turns(path)
    if len(turns) < 2:
        return None
    n = len(turns)

    # Carry cost. The delta into turn i is what the preceding tool result and
    # assistant output added to context; it is then re-read on every turn after
    # i. Turn 0 is the session's fixed floor (system prompt + CLAUDE.md + tool
    # schemas), reported separately because it is a standing cost, not an event.
    events = []
    reprimes = []
    for i in range(1, n):
        # A re-prime is the cache expiring, not context growing: the 1h prompt
        # cache TTL lapses over an idle gap and the identical context is billed
        # as creation instead of a read. Counting it as a payload would blame a
        # coffee break on whatever tool ran last -- and creation is dearer than
        # read, so it is worth naming on its own.
        if turns[i]["read"] == 0 and turns[i]["created"] > NOISE_FLOOR:
            gap = minutes_between(turns[i - 1]["ts"], turns[i]["ts"])
            reprimes.append({"turn": i, "tokens": turns[i]["created"], "idle_min": gap})
            continue
        delta = turns[i]["context"] - turns[i - 1]["context"]
        if delta < NOISE_FLOOR:
            continue
        events.append(
            {
                "turn": i,
                "added": delta,
                "carry": delta * (n - i),
                # The tools named on the *previous* turn are the ones whose
                # results landed in this turn's context.
                "cause": ", ".join(turns[i - 1]["tools"]) or "(text/thinking)",
                "cmd": (turns[i - 1]["commands"] or [""])[0][:90].replace("\n", " "),
            }
        )
    events.sort(key=lambda e: -e["carry"])
    # Consecutive identical re-primes are one event billed twice (a retry), so
    # the count below is of billing events, which is what actually costs.

    floor = turns[0]["context"]
    tool_counts: dict[str, int] = {}
    single = multi = 0
    for t in turns:
        for name in t["tools"]:
            tool_counts[name] = tool_counts.get(name, 0) + 1
        if len(t["tools"]) == 1:
            single += 1
        elif len(t["tools"]) > 1:
            multi += 1

    cmds: dict[str, int] = {}
    for t in turns:
        for c in t["commands"]:
            if c.strip():
                fp = fingerprint(c)
                cmds[fp] = cmds.get(fp, 0) + 1

    return {
        "session": path.stem,
        "turns": n,
        "total_input": sum(t["context"] for t in turns),
        "read": sum(t["read"] for t in turns),
        "created": sum(t["created"] for t in turns),
        "output": sum(t["output"] for t in turns),
        "thinking": sum(t["thinking"] for t in turns),
        "peak": max(t["context"] for t in turns),
        "mean_context": sum(t["context"] for t in turns) // n,
        "floor": floor,
        "floor_cost": floor * n,
        "single_tool_turns": single,
        "multi_tool_turns": multi,
        "tools": tool_counts,
        "events": events,
        "reprimes": [r for r in reprimes if r["idle_min"] >= IDLE_MIN],
        "reprime_tokens": sum(r["tokens"] for r in reprimes if r["idle_min"] >= IDLE_MIN),
        "warmup_tokens": sum(r["tokens"] for r in reprimes if r["idle_min"] < IDLE_MIN),
        "repeats": sorted(((c, k) for k, c in cmds.items() if c > 1), key=lambda x: -x[0]),
        "start": turns[0]["ts"][:16].replace("T", " "),
    }


def minutes_between(a: str, b: str) -> int:
    """Whole minutes between two ISO timestamps; 0 if either is unparseable."""
    try:
        ta = datetime.fromisoformat(a.replace("Z", "+00:00"))
        tb = datetime.fromisoformat(b.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return 0
    return int((tb - ta).total_seconds() // 60)


def human(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}k"
    return str(n)


def print_summary(reports: list[dict]) -> None:
    print(
        f"\n{'session':<12} {'when':<17} {'turns':>6} {'input':>8} "
        f"{'out':>6} {'mean ctx':>9} {'peak':>7}"
    )
    print("-" * 72)
    for r in reports:
        print(
            f"{r['session'][:8]:<12} {r['start']:<17} {r['turns']:>6} "
            f"{human(r['total_input']):>8} {human(r['output']):>6} "
            f"{human(r['mean_context']):>9} {human(r['peak']):>7}"
        )
    tot_in = sum(r["total_input"] for r in reports)
    tot_out = sum(r["output"] for r in reports)
    print("-" * 72)
    print(
        f"{'TOTAL':<12} {'':<17} {sum(r['turns'] for r in reports):>6} "
        f"{human(tot_in):>8} {human(tot_out):>6}"
    )
    if tot_in:
        print(
            f"\nInput re-reads are {100 * tot_in / (tot_in + tot_out):.1f}% "
            f"of all tokens across these sessions."
        )


def print_detail(r: dict) -> None:
    print(
        f"\n{'=' * 72}\nSESSION {r['session'][:8]}   {r['start']}   {r['turns']} turns\n{'=' * 72}"
    )
    print(
        f"  total input   {human(r['total_input']):>8}   "
        f"(cache read {human(r['read'])}, created {human(r['created'])})"
    )
    print(f"  output        {human(r['output']):>8}   (thinking {human(r['thinking'])})")
    print(f"  mean context  {human(r['mean_context']):>8} per turn, peak {human(r['peak'])}")

    print("\n  FIXED FLOOR (system prompt + CLAUDE.md + tool schemas)")
    print(
        f"    {human(r['floor'])} re-read {r['turns']} times "
        f"= {human(r['floor_cost'])} tokens "
        f"({100 * r['floor_cost'] / r['total_input']:.0f}% of session input)"
    )

    print("\n  WORST CARRY COST -- what each turn's payload cost the rest of the session")
    print(f"    {'turn':>5} {'added':>7} {'carried':>9}  cause")
    for e in r["events"][:10]:
        detail = e["cmd"] if e["cmd"] else e["cause"]
        print(
            f"    {e['turn']:>5} {human(e['added']):>7} "
            f"{human(e['carry']):>9}  {e['cause'][:22]:<22} {detail[:34]}"
        )
    fat = [e for e in r["events"] if e["added"] >= FAT_RESULT]
    if fat:
        waste = sum(e["carry"] for e in fat)
        print(
            f"\n    {len(fat)} turns added >={human(FAT_RESULT)} tokens each; "
            f"together they carried {human(waste)} "
            f"({100 * waste / r['total_input']:.0f}% of session input)."
        )

    if r["reprimes"]:
        print("\n  CACHE RE-PRIMES -- context rebuilt after walking away")
        for rp in r["reprimes"][:5]:
            print(
                f"    turn {rp['turn']:>4}  {human(rp['tokens']):>7} rebuilt "
                f"after {rp['idle_min']} min idle"
            )
        print(
            f"    {len(r['reprimes'])} idle re-primes, "
            f"{human(r['reprime_tokens'])} tokens billed as creation (dearer "
            f"than read) rather than read."
        )

    print("\n  TURN SHAPE")
    print(
        f"    {r['single_tool_turns']} turns made exactly 1 tool call, "
        f"{r['multi_tool_turns']} batched 2+."
    )
    tool_turns = r["single_tool_turns"] + r["multi_tool_turns"]
    if tool_turns:
        rate = 100 * r["multi_tool_turns"] / tool_turns
        print(
            f"    Batched {rate:.0f}% of tool-calling turns. Each un-batched "
            f"pair costs an extra ~{human(r['mean_context'])} re-read."
        )
        # Deliberately no "you could have saved N" figure. A transcript cannot
        # distinguish a missed batch from genuinely sequential work -- read
        # before edit, edit before test -- so any such number would assert an
        # unmeasured ratio. Report the rate and let a human judge the run.
    top = sorted(r["tools"].items(), key=lambda x: -x[1])[:6]
    print("    " + "  ".join(f"{k}:{v}" for k, v in top))

    if r["repeats"]:
        print("\n  REPEATED COMMANDS -- candidates for a script in tools/")
        for count, fp in r["repeats"][:8]:
            print(f"    {count:>3}x  {fp[:66]}")


def log_row(r: dict) -> dict:
    """The compact, durable subset worth keeping after a transcript is deleted.

    Transcripts age out (`cleanupPeriodDays`, 30 by default), so a measurement
    taken today is unreproducible next month. These are the fields the DO/DON'T
    advice in `specs/SESSION-HYGIENE.md` is actually judged on -- ratios, not
    raw sizes, so they stay comparable across sessions of different lengths.
    """
    tool_turns = r["single_tool_turns"] + r["multi_tool_turns"]
    fat = sum(e["carry"] for e in r["events"])
    return {
        "session": r["session"],
        "start": r["start"],
        "turns": r["turns"],
        "total_input": r["total_input"],
        "output": r["output"],
        "floor": r["floor"],
        "mean_context": r["mean_context"],
        "peak": r["peak"],
        "reprimes": len(r["reprimes"]),
        "reprime_tokens": r["reprime_tokens"],
        "fat_payload_share": round(fat / r["total_input"], 4) if r["total_input"] else 0.0,
        "batch_rate": round(r["multi_tool_turns"] / tool_turns, 4) if tool_turns else 0.0,
        "tools": dict(sorted(r["tools"].items(), key=lambda kv: -kv[1])[:8]),
    }


def append_log(reports: list[dict], path: Path) -> int:
    """Append one line per session, skipping sessions already logged at this length.

    Idempotent on purpose. The SessionEnd hook only fires on a clean exit -- a
    killed terminal writes nothing -- so the same command must also work as a
    backfill over every transcript without duplicating what it already holds.
    A session that grew since its last row (resumed, or logged mid-run) is
    appended again; NDJSON keeps history, so the last row for an id wins.
    """
    seen: dict[str, int] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            sid = row.get("session")
            if sid:
                seen[sid] = max(seen.get(sid, 0), row.get("turns", 0))

    rows = [log_row(r) for r in reports if r["turns"] > seen.get(r["session"], -1)]
    if rows:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, separators=(",", ":")) + "\n")
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--cwd", default=os.getcwd(), help="project whose transcripts to read (default: cwd)"
    )
    ap.add_argument("--session", help="drill into one session id (prefix ok)")
    ap.add_argument(
        "--top", type=int, default=3, help="how many of the biggest sessions to detail (default 3)"
    )
    ap.add_argument("--json", action="store_true", help="emit JSON instead")
    ap.add_argument(
        "--append-log",
        metavar="PATH",
        help="append one compact JSON line per session to PATH and exit "
        "(idempotent; safe to re-run as a backfill). Used by the SessionEnd hook.",
    )
    args = ap.parse_args()

    pdir = project_dir(Path(args.cwd).resolve())
    if not pdir.is_dir():
        print(f"No transcripts for {args.cwd}\n  (looked in {pdir})", file=sys.stderr)
        return 1

    paths = [p for p in pdir.glob("*.jsonl") if "orphaned" not in p.name]
    if args.session:
        paths = [p for p in paths if p.stem.startswith(args.session)]
        if not paths:
            # Nothing to log is not an error for the hook -- a session can end
            # before its transcript is flushed, and a hook that exits non-zero
            # is noise on every such exit.
            if args.append_log:
                return 0
            print(f"No session matching {args.session!r}", file=sys.stderr)
            return 1

    reports = [r for r in (analyse(p) for p in sorted(paths)) if r]
    if not reports:
        if args.append_log:
            return 0
        print("No sessions with usage data found.", file=sys.stderr)
        return 1
    reports.sort(key=lambda r: -r["total_input"])

    if args.append_log:
        append_log(reports, Path(args.append_log).expanduser())
        return 0

    if args.json:
        json.dump(reports, sys.stdout, indent=2)
        return 0

    print_summary(reports)
    for r in reports[: (len(reports) if args.session else args.top)]:
        print_detail(r)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
