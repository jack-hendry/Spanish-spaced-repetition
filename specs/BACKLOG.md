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
- [ ] (2026-08-28) Investigate delegating the final commit-and-PR step of a
  task/spec run to a cheaper subagent (Haiku or Sonnet) instead of doing it
  at the top level. The idea: that subagent commits and opens the PR
  automatically, without a per-commit confirmation from the user, and the
  user's review moves to the PR itself rather than to a pre-commit
  permission prompt. Would need to reconcile with the working agreement's
  "never commit without explicit permission" rule (`CLAUDE.md`) — this is
  effectively asking for a standing, scoped exception rather than a
  case-by-case one, so it needs a clear boundary (which branches/paths
  qualify, what still requires a stop-and-ask) before it's safe to adopt.
  Not scoped yet; worth checking whether cost savings and reduced
  interruption are worth the loss of a manual gate before every commit.
- [ ] (2026-09-17) Keep bot/scanner traffic from waking the Fly machine.
  The deployed app (`fly.toml`, spec 021, archived
  `archive/2026-09-17-021-fly-deploy`) is public at `spanish-srs.fly.dev`
  with `auto_start_machines = true`, so any inbound request — including
  bot/scanner probes, e.g. via CT-log discovery of the TLS cert — wakes the
  sleeping machine before basic auth ever runs, since the wake happens at
  Fly's proxy layer, before the app's own auth middleware. Cost per wake is
  small (shared-cpu-1x:256MB, confirmed via `fly status`/`fly machine list`)
  so not urgent, but worth fixing eventually since it's the one gap in an
  otherwise scale-to-zero setup. Options surfaced so far, none scoped:
  (1) put a bot-filtering proxy (e.g. Cloudflare) in front — needs the user
  to own a custom domain, since `.fly.dev` can't be proxied through one;
  (2) accept the noise and rely on a Fly billing/spending alert instead
  (dashboard-only, not set up yet); (3) Fly WireGuard private networking —
  fully blocks public ingress but breaks the phone-over-cellular access
  spec 021 was built for; (4) lightweight app-level tweaks (hostname
  rotation, tighter `express-rate-limit` tiers in `server/src/app.ts`) —
  reduces opportunistic scanning only, doesn't stop the proxy-level wake.
  Needs sizing before it becomes a Quick Task or a spec.
- [ ] (2026-09-17) **A `revlog.ndjson` → `cards.json` repair tool.** Deferred
  out of spec `022-backup-and-restore` as its **O1** (Analyst §3); the idea
  originates in `specs/011-mobile-remote-access/ROADMAP.md` Phase 2's last
  bullet, "worth a one-off repair tool if it ever proves cheap". The safety
  net it would cash in: `revlog.ndjson` is append-only and holds every review
  ever answered, so a damaged or truncated `cards.json` is *in principle*
  rebuildable from it — nothing does that today, so in practice a corrupt
  `cards.json` is only recoverable by rolling back to an older git commit or
  a Fly volume snapshot (see AD on retention from 022). Why it is not cheap:
  rebuilding card state means **replaying SM-2/FSRS over the entire review
  history**, which is a scheduling-domain change, and `CLAUDE.md` classes
  anything touching scheduling, the study queue, `card.due` or the on-disk
  shape as **at least Large on its own** — read
  `.claude/skills/scheduling-domain` before scoping it. Extra wrinkles a
  future spec must answer: a card's FSRS `stability`/`difficulty` are null
  until FSRS first schedules it, so a replay has to know *which* scheduler
  each deck used at the time; `revlog` does not record deck-options changes;
  and cards created after the last review have no revlog rows at all, so a
  pure replay cannot reconstruct the "new" queue positions. Not scoped.
- [ ] (2026-09-17) **`/api/review` can leave `revlog.ndjson` ahead of
  `cards.json` on a hard kill.** Deferred out of spec `022-backup-and-restore`
  as its **O2** (Analyst §3); also recorded in `ROADMAP.md`'s Discovered list
  (2026-09-17), promoted there out of `021-fly-deploy` C9. `routes/index.ts`
  (~116-123) calls `store.saveCardsSoon()` — debounced ~400ms so a burst of
  reviews coalesces into one rewrite — but `await`s `store.appendRevlog(...)`
  immediately. A **hard** kill inside that ~400ms window (a crash, an OOM, a
  `SIGKILL`) therefore leaves the append-only revlog claiming a review that
  `cards.json` does not reflect. The **signalled** path is fine and was
  verified in spec 021 Step 20 — `flushAll()` runs on SIGINT/SIGTERM and exits
  0 — so this is only about kills that skip the handler. It is not new, but
  Fly's auto-stop made the window **reachable for the first time**. Two
  separable halves, either of which could be its own task: *detecting* the
  divergence (compare the revlog tail against `cards.json`, e.g. on boot in
  `FileStore.init()`) and *repairing* it (which collapses into O1 above). Left
  out of 022 because that spec is infrastructure and tooling only — this is a
  server-side durability bug on the persistence path (022's O5 forbids it),
  and it is a scheduling-domain change, so **at least Large**. Not scoped.
- [ ] (2026-09-18) **Offline capability for the web app.** Raised by the user
  ahead of a trip to Guatemala with uncertain connectivity. The review loop
  currently requires a live round-trip (`SPA rates a card → POSTs card state +
  RevlogEntry to /api/review`) — there's no local-first/offline storage today.
  Real support means the Angular frontend caching the collection/cards
  (service worker + cached snapshot for `CollectionStore` init) for read-only
  offline study, plus a local write-behind queue (e.g. IndexedDB) for reviews
  taken offline, synced to `/api/review` on reconnect. Main risk: scheduling
  state lives entirely in the frontend (`web/src/app/core/`), so reconciling a
  batch of offline reviews without clobbering state from a concurrent
  multi-device session needs real thought. At least **Large** per the sizing
  table — touches persistence, the data model, and the review loop. A lighter
  first cut was floated: cache collection/cards for read-only offline study
  only, defer the write-behind queue to a later pass. Not scoped yet.
