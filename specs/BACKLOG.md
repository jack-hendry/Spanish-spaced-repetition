# BACKLOG — ideas to investigate later

Ideas that aren't scoped or scheduled yet — things worth doing eventually but
not worth a spec today. This is not `STATE.md`: nothing here is a decision,
a lesson, or completed work. An idea graduates out of this file the moment it
gets sized (see the [Task sizing rule](../CLAUDE.md#task-sizing-rule-sdd) in
`CLAUDE.md`) and becomes a Quick Task or a `specs/<feature-name>/` folder —
at that point, strike it here with the date and a pointer to where it went.

## Rules for this file

1. **Append-only, newest at the bottom.** Don't reorder or renumber; a
   half-baked idea from six months ago is still worth being able to find.
2. **Each entry is dated and says why it might matter**, not just what it is —
   a one-line idea with no reasoning is hard to evaluate later.
3. **Mark an idea done, not delete it**, when it's picked up: strike the line
   (`~~like this~~`) and note the date and where it went (Quick Tasks row,
   spec folder name, or "rejected: <reason>").
4. No process gate enforces this file — it's a scratchpad, not a hook target.

## Ideas

- [ ] (2026-08-26) Nothing logged yet — add ideas here as they come up.
- [ ] (2026-08-27) Opus sessions sometimes do heavy tool-search legwork
  (many `ToolSearch`/grep-style calls hunting for something) directly at the
  top level instead of delegating it. Investigate whether search-heavy
  subtasks should be routed to a Sonnet/Haiku subagent (e.g. the `Explore`
  agent type) rather than switching the whole session's model — mirrors the
  `haiku`/`sonnet`/`top-level`, never-`opus` delegation rule this repo
  already uses for `tasks.md` steps. Not scoped yet; worth checking whether
  it's a prompting/tool-batching issue or a genuine delegation gap.
- [ ] (2026-08-28) Want a way to check that the Spanish sentences are
  grammatically correct, starting with
  `data/spanish/_source/10000-spanish-vocabulary-part-1-of-3.json` (the
  McGraw Hill scrape's `SideA`/`SideB` fields carry `word<br>example
  sentence` pairs — the sentence is the grammar-check target, not the
  headword). Likely wants to be repeatable — re-run after each
  scrape/import rather than a one-off pass — so probably some kind of
  grammar-check tool or LLM-assisted linter invoked from the Python
  pipeline or as a standalone script, with a way to report/flag suspect
  cards for review rather than silently "fixing" them. Not scoped yet:
  unclear whether this checks source JSON pre-import, the canonical store
  post-import, or both; whether it should cover just this one source file
  or all of `_source/`; and what the false-positive tolerance should be.
