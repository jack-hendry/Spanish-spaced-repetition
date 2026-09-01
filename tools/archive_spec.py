#!/usr/bin/env python3
"""Move a finished spec into `specs/archive/` and trim it to what matters.

CLAUDE.md's end-of-feature ritual has five steps. Steps 3 and 4 -- "summarize
the spec down to what matters" and "move the folder" -- are mechanical, and
doing them by hand is expensive: an `Analyst.md` over the pre-push hook's 20 KB
per-file cap has to be read in full and rewritten as prose, which is the single
costliest part of archiving. This script is those two steps, executable, the
same way `state_rotate.py` is the size-budget rule executable.

What it does NOT do, deliberately:

  * It never touches `specs/STATE.md` or `specs/LESSONS.md`. Which findings
    deserve an `AD`/`L` entry is a judgement call, and ritual step 2 is the
    whole reason the ritual exists. The script prints the checklist and stops.
  * It never rewrites prose. It drops whole sections by heading and reports
    exactly what it dropped. A file still over the cap after pruning is
    reported, not mangled -- a human summarizes that one.

Two modes, the same split `state_rotate.py` uses:

    (default)  Dry run. Prints the plan -- what moves, what is dropped, what is
               still over the cap -- and writes nothing.
    --apply    Perform the moves via `git mv` / `git rm`, prune the oversized
               files, and stage the result.

Sections are dropped by heading match, not by position, and only from files
that are actually over the cap. The default drop list is the two kinds of
section that reliably do not survive archiving: a retrospective (process
commentary, whose durable half belongs in `LESSONS.md` under an `L-NNN`) and a
pre-run "how do we know it is done" list (superseded by the acceptance
walk-through written after the run). Everything else is kept.

Every pruned file gets a provenance line under its H1 saying it is abridged and
naming the sections removed, so a reader is never silently handed a partial
document. The full text stays in git history regardless.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import date as date_cls
from pathlib import Path

# The pre-push hook's per-file limit (scripts/clean-table-check.sh
# SIZE_LIMIT_BYTES). Kept in sync by hand; the hook owns the rule, this only
# predicts it, so a mismatch shows up as the hook refusing a push rather than
# as silent corruption.
SIZE_LIMIT_BYTES = 20480

# Headings whose sections come out of an oversized file. Matched
# case-insensitively against the heading text, anywhere in it.
DEFAULT_DROP_SECTIONS = (
    r"retrospective",
    r"how do we know",
)

# An execution log this large is working notes, not spec content -- the same
# call made by hand for 017/018/019. Under the cap it is cheap history and is
# kept, which is why 016 and 020 still have theirs.
TASKS_FILENAME = "tasks.md"

HEADING_RE = re.compile(r"^## +(.+?)\s*$")
DATE_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-")


@dataclass
class Section:
    """One `## ` heading and everything under it, up to the next `## `."""

    heading: str
    start: int  # index into the source lines, inclusive (the heading line)
    end: int  # exclusive

    def matches(self, patterns: tuple[str, ...]) -> bool:
        return any(re.search(p, self.heading, re.IGNORECASE) for p in patterns)


@dataclass
class FilePlan:
    """What is going to happen to one file in the spec folder."""

    path: Path
    size: int
    action: str  # "move", "prune", or "drop"
    dropped: list[str] = field(default_factory=list)
    projected: int = 0

    @property
    def still_over(self) -> bool:
        return self.action in {"move", "prune"} and self.projected > SIZE_LIMIT_BYTES


def run_git(args: list[str], repo: Path) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def repo_root() -> Path:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        sys.exit("archive_spec: not inside a git repository")
    return Path(out)


def parse_sections(lines: list[str]) -> list[Section]:
    """Every `## ` section in file order. Content before the first one is not
    a section and is therefore never droppable -- that is the H1 and the intro.
    """
    sections: list[Section] = []
    for i, line in enumerate(lines):
        heading = HEADING_RE.match(line)
        if not heading:
            continue
        if sections:
            sections[-1].end = i
        sections.append(Section(heading=heading.group(1), start=i, end=len(lines)))
    return sections


def prune_text(text: str, patterns: tuple[str, ...]) -> tuple[str, list[str]]:
    """Drop whole sections whose heading matches. Returns the new text and the
    headings removed, in file order.
    """
    lines = text.splitlines()
    doomed = [s for s in parse_sections(lines) if s.matches(patterns)]
    if not doomed:
        return text, []

    keep = [True] * len(lines)
    for section in doomed:
        for i in range(section.start, section.end):
            keep[i] = False

    kept = [line for line, k in zip(lines, keep) if k]
    while kept and not kept[-1].strip():
        kept.pop()
    return "\n".join(kept) + "\n", [s.heading for s in doomed]


def provenance_line(dropped: list[str]) -> str:
    listed = "; ".join(f"`## {h}`" for h in dropped)
    return (
        f"*Abridged when archived: {listed} removed to fit the "
        f"{SIZE_LIMIT_BYTES // 1024} KB archive cap. Full text in git history.*"
    )


def insert_provenance(text: str, dropped: list[str]) -> str:
    """Put the abridged notice directly under the H1, so it is the first thing
    read. A file with no H1 gets it at the top.
    """
    lines = text.splitlines()
    note = provenance_line(dropped)
    for i, line in enumerate(lines):
        if line.startswith("# "):
            rest = lines[i + 1 :]
            while rest and not rest[0].strip():
                rest.pop(0)
            return "\n".join([*lines[: i + 1], "", note, "", *rest]) + "\n"
    return note + "\n\n" + text


def build_plan(spec_dir: Path, patterns: tuple[str, ...], keep_tasks: bool) -> list[FilePlan]:
    plans: list[FilePlan] = []
    for path in sorted(spec_dir.iterdir()):
        if path.is_dir():
            sys.exit(f"archive_spec: nested directory not handled: {path}")
        size = path.stat().st_size

        if path.name == TASKS_FILENAME and not keep_tasks and size > SIZE_LIMIT_BYTES:
            plans.append(FilePlan(path=path, size=size, action="drop"))
            continue

        if path.suffix == ".md" and size > SIZE_LIMIT_BYTES:
            text = path.read_text(encoding="utf-8")
            pruned, dropped = prune_text(text, patterns)
            if dropped:
                pruned = insert_provenance(pruned, dropped)
                plans.append(
                    FilePlan(
                        path=path,
                        size=size,
                        action="prune",
                        dropped=dropped,
                        projected=len(pruned.encode("utf-8")),
                    )
                )
                continue

        plans.append(FilePlan(path=path, size=size, action="move", projected=size))
    return plans


def find_references(repo: Path, spec_name: str) -> list[str]:
    """Files outside the spec folder that name it. Archiving breaks these, and
    ritual step 4 says to update anything that linked to the old path.
    """
    try:
        out = run_git(["grep", "-l", "--", f"specs/{spec_name}"], repo)
    except subprocess.CalledProcessError:
        return []  # git grep exits 1 when nothing matches
    return [line for line in out.splitlines() if not line.startswith(f"specs/{spec_name}/")]


def report(plans: list[FilePlan], spec_name: str, target: Path, refs: list[str]) -> None:
    print(f"archive_spec: specs/{spec_name}/ -> {target}")
    for plan in plans:
        if plan.action == "drop":
            print(f"  drop   {plan.path.name}  ({plan.size} bytes, over cap; kept in git history)")
        elif plan.action == "prune":
            print(f"  prune  {plan.path.name}  ({plan.size} -> {plan.projected} bytes)")
            for heading in plan.dropped:
                print(f"           dropped section: ## {heading}")
        else:
            print(f"  move   {plan.path.name}  ({plan.size} bytes)")

    over = [p for p in plans if p.still_over]
    if over:
        print("\narchive_spec: STILL OVER THE CAP -- summarize these by hand before pushing:")
        for plan in over:
            print(f"  - {plan.path.name} ({plan.projected} bytes, limit {SIZE_LIMIT_BYTES})")

    if refs:
        print("\narchive_spec: these files reference the old path (ritual step 4):")
        for ref in refs:
            print(f"  - {ref}")


def checklist(spec_name: str) -> None:
    print(
        "\narchive_spec: the judgement calls are yours (ritual step 2) --\n"
        "  1. Confirm this spec's AD / B entries and L headlines are in specs/STATE.md,\n"
        "     each L with its body in specs/LESSONS.md, or the push gate refuses.\n"
        "  2. Update the references listed above to the new archive path.\n"
        "  3. python3 tools/state_rotate.py --check   (rotate if over budget)\n"
        f"  4. RANGE_OVERRIDE=origin/main..HEAD bash scripts/clean-table-check.sh\n"
        f"  5. Commit the move and the STATE.md entries together -- never the move alone\n"
        f"     (specs/{spec_name} archived without its lessons is silent memory loss)."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Archive a finished spec folder and trim it to what matters.",
    )
    parser.add_argument("spec", help="spec folder, e.g. specs/017-lint-phase1-web or 017-…")
    parser.add_argument(
        "--date",
        default=date_cls.today().isoformat(),
        help="finish date for the archive folder name (default: today)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="perform the move; without this the script only prints the plan",
    )
    parser.add_argument(
        "--keep-tasks",
        action="store_true",
        help="archive tasks.md even when it is over the cap (default: drop it)",
    )
    parser.add_argument(
        "--drop-section",
        action="append",
        default=[],
        metavar="REGEX",
        help="extra heading pattern to drop from oversized files (repeatable)",
    )
    args = parser.parse_args()

    repo = repo_root()
    spec_dir = (repo / args.spec) if not Path(args.spec).is_absolute() else Path(args.spec)
    if not spec_dir.is_dir():
        spec_dir = repo / "specs" / args.spec
    if not spec_dir.is_dir():
        sys.exit(f"archive_spec: no such spec folder: {args.spec}")

    spec_dir = spec_dir.resolve()
    spec_name = spec_dir.name
    if "archive" in spec_dir.relative_to(repo).parts[:2] or DATE_DIR_RE.match(spec_name):
        sys.exit(f"archive_spec: {spec_name} looks already archived")

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", args.date):
        sys.exit(f"archive_spec: --date must be YYYY-MM-DD, got {args.date}")

    target = repo / "specs" / "archive" / f"{args.date}-{spec_name}"
    if target.exists():
        sys.exit(f"archive_spec: target already exists: {target}")

    patterns = (*DEFAULT_DROP_SECTIONS, *args.drop_section)
    plans = build_plan(spec_dir, patterns, args.keep_tasks)
    refs = find_references(repo, spec_name)
    report(plans, spec_name, target.relative_to(repo), refs)

    if not args.apply:
        print("\narchive_spec: dry run, nothing written. Re-run with --apply.")
        return 0

    target.mkdir(parents=True)
    for plan in plans:
        rel = plan.path.relative_to(repo)
        if plan.action == "drop":
            run_git(["rm", "-q", "--", str(rel)], repo)
            continue
        dest = target / plan.path.name
        run_git(["mv", "--", str(rel), str(dest.relative_to(repo))], repo)
        if plan.action == "prune":
            text = dest.read_text(encoding="utf-8")
            pruned, dropped = prune_text(text, patterns)
            dest.write_text(insert_provenance(pruned, dropped), encoding="utf-8")
            run_git(["add", "--", str(dest.relative_to(repo))], repo)

    print(f"\narchive_spec: moved to {target.relative_to(repo)} and staged.")
    checklist(spec_name)
    return 1 if any(p.still_over for p in plans) else 0


if __name__ == "__main__":
    raise SystemExit(main())
