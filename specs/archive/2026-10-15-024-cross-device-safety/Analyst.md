# Analyst — 024 · Cross-device safety

Phase 4 of `specs/011-mobile-remote-access/ROADMAP.md`. **Size: Large** — the
`/api/review` contract, the on-disk card shape (server model + web mirror), the
outbox's failure classification and the review loop. Phase 3
(`specs/archive/2026-10-11-023-review-outbox`) made a review *arrive*; Phase 4
makes a **late** review lose to a newer one instead of silently overwriting it.

*Summarized at archive time (2026-10-15). `tasks.md` (13 steps, per-step
evidence) was dropped as over the size cap; its finished version is in git
history at commit `f354c85` (`git show f354c85:specs/024-cross-device-safety/
tasks.md`). What mattered from it is in "What changed from the plan" and §5.*

## 1. Problem

`POST /api/review` replaced the stored card wholesale with the client's copy
(`cards[idx] = { ...card, modified: Date.now() }`), with no version check. So:
the phone loads the collection at T0; the desktop studies card X at T1; the
phone studies X at T2 from its T0 snapshot, and its POST erases the desktop's
review from `cards.json` — no error, no log, nothing in either UI. Phase 3 made
this *more* likely: an outbox op can arrive hours after it was computed.

Four facts from the code shaped the design:

1. **The loss is asymmetric.** `revlog.ndjson` is append-only and deduped, so
   both reviews survive there and only `cards.json` loses one — detectable after
   the fact.
2. **`card.modified` cannot be the token.** Both schedulers return
   `{ ...card, modified: ctx.now }` — a *client* clock the server never sees —
   so an `expectedModified` check would false-conflict on the second review of a
   card in one session, i.e. every learning step.
3. **A precondition fights Phase 3's replay safety.** A POST the server applied
   but whose response was lost must be retried; a naive precondition rejects
   that retry, because the server's own write moved the version.
4. **409 was classified `'retry'`**, so a shipped conflict would retry a stale
   body forever and spend the tier-1 rate limiter's failure budget.

## 2. Scope

- **Server:** optional `Card.rev`; `POST /review` dedupes first (a replay must
  not write the card), then checks `expectedRev` by equality (409 + stored card
  on mismatch), then applies with `rev = revlog.id`. Web model mirrored.
- **Web:** `rate()` sends `expectedRev` and sets its local `rev`; `classify()`
  gains `'conflict'`; a `ConflictResolver` outside `OutboxService` re-applies
  rejected ratings; conflicts get their own banner text; a 409 counter.
- **Verification:** server integration tests, web specs, and a real
  two-device run judged from pulled live state, never a UI.

## 3. Out of scope

- The other write paths (`PATCH /cards/:id`, `PATCH /decks/:id {daily}`,
  `PATCH /collection`): narrow, recomputable field patches, not wholesale
  replacements. Accepted: a stale `daily` patch can lower a tally; a stale bury
  can overwrite a desktop `suspended`.
- `POST /collection/resume` — moves `due` without touching `rev` (see
  Discovered). Desktop-only, and re-apply never trusts a stale card.
- A presence / "open elsewhere" signal — declined; the 409 says it at the moment
  it matters. Revisit if the conflict counter shows conflicts are frequent.
- The `revlog → cards.json` repair tool, the rate-limiter lockout (not worsened,
  not fixed), any scheduling math, merging two genuine reviews of one card (both
  apply, in arrival order), offline reload / PWA.

## 4. Design decisions

**D1 — The token is an explicit `card.rev`, not `card.modified`** (fact 2).
Also avoids a second overloaded field: `modified` keeps meaning "when the server
last wrote this".

**D2 — `rev` is the `RevlogEntry.id` that produced the state.** Already
client-minted, unique, stable across retries and the server's dedupe key, so
precondition value, queue key and dedupe key coincide by construction, and each
`cards.json` row points at a revlog line.

**D3 — Compare by equality, never ordering**, so device clock skew is irrelevant.

**D4 — Absent `rev` self-migrates; the two absences differ.** No migration:
`rev` fills in as cards are reviewed. `expectedRev` **missing** = wildcard (a
pre-024 op still in someone's `localStorage` cannot carry the field); explicit
**`null`** = "I scheduled from a card with no `rev`". Residual race: two devices
writing a virgin card from `null` — the first wins, the second is rejected.

**D5 — Dedupe strictly before the precondition, and a replay must not write the
card.** Dedupe-first keeps every Phase 3 replay a 200; not writing on replay
closes the clobber reachable through the retry path.

**D6 — A 409 is resolved by re-applying the rating, not discarding it** (user
decision, §6). The 409 body carries the server card; the op's revlog carries
`button` and `timeMs` — everything `Scheduler.answer()` needs. **Intended per
*snapshot*, not per op** (critic C-2): a stale snapshot is stale for the whole
queue, so reload once and re-apply, because each 409 spends part of the tier-1
limiter's 20-failures-per-15-min budget. Bounded (2 reload cycles per drain
pass) so two devices cannot ping-pong; on exhaustion the op is parked in a
visible, never-auto-deleted `conflicts` list. Depends on `load()` actually
awaiting — L-028's third sighting, fixed here rather than worked around.

**D7 — Conflicts get their own UI words**, distinct from "unsaved": the review
was rejected and re-applied, or could not be.

**D8 — The outbox *detects*; a separate `ConflictResolver` *resolves*** (C-1).
`CollectionStore` already injects `OutboxService`, and the resolver needs the
store, so resolving inside the outbox would be a DI and ESM cycle. The seam is
`OutboxService.setConflictHandler`.

**D9 — `rev` is assigned only where a revlog entry is minted, never carried by a
spread** (C-3). The server sets `rev = revlog.id` and ignores `card.rev`, or the
stored token lags one review and every later write conflicts. The client sets
its cached card's `rev`, or the next review in the session false-conflicts.

**D10 — The resolver re-schedules at the original answer instant**:
`ctx = { now: revlog.reviewedAt, today: todayNumber(coll, revlog.reviewedAt) }`.
The result is what would have happened had the op arrived in order; a learning
`due` in the past is correct. Recorded as a `scheduling-domain` lesson.

## 5. Acceptance — criteria and verdicts (2026-10-15)

- **A1 — Desktop's review survives a stale phone write; judged from live
  state. MET.** Production, release v6, 3 of 3 runs: revlog 4034 → 4040, two
  entries per card, 0 duplicate ids; `reps` +2 each (6→8, 28→30, 3→5); each
  card's `rev` is the **second** entry's id, which builds on the first
  (`relearn 1→1` then `review 1→2`; `review 45→126` then `126→353`). The 409
  itself was seen in the local run; on the phone it is inferred.
- **A2 — The stale-rejection test is red against the pre-change route. MET.**
  `expected 200 to be 409 // Object.is equality`, by commenting the check out.
  Same discipline for L-028's fix and for D10 (`expected 1791742213771 to be
  1791741913771` — the spec's 5-minute offset).
- **A3 — A Phase 3 replay (identical body twice) → 200 twice, one revlog line,
  card byte-identical. MET** (`review-staleness.integration.test.ts`). 023's
  *differing*-body case was amended, user-approved; A3 is defined over an
  identical body, so it was not weakened.
- **A4 — An offline chain of reviews of one card never self-conflicts. MET, at
  unit level:** the client spec asserts the second review's `expectedRev` equals
  the first's concrete `revlog.id`; the server half is pinned separately. No
  live offline multi-step run.
- **A5 — A virgin card is accepted; a second write from a stale snapshot of it is
  rejected. MET** in tests, and observed live in the local run.
- **A6 — The resolver's bound holds and the queue behind still drains. MET, at
  unit level** (`conflict-resolver.spec.ts:273`; outbox T19).
- **A7 — No blind 409 retry; a full stale queue resolves within budget. PARTLY
  NOT MET.** No-retry holds (classified `'conflict'`; T20 asserts no `attempts`
  increment and no `'waiting'` — a proxy for "no backoff timer"; the local run
  showed one 409 → reload → 200). But the third conflicting op in one drain pass
  is parked — see Discovered.
- **A8 — test / build / lint / format all green, verified independently. MET**
  by exit code: server 95, web 290; server suite green over 10+ runs. Falsely
  reported green from Step 2 to 8 while the server suite exited 1 (L-031).

## 6. Open questions — resolved

1. Re-apply vs warn-only → **re-apply** (user, 2026-10-11): the only option that
   keeps the rejected review.
2. The bound of 2 reload cycles per pass — a guess, not a measurement; see A7.
3. `PATCH /cards/:id` does **not** set `rev`, so a bury never invalidates a
   queued review. A decision, not an oversight.
4. Fix `CollectionStore.load()` in this spec → **yes** (user): it now returns the
   in-flight promise.

## What changed from the plan

- **Step 2:** 023's test asserting last-write-wins on a differing-body replay
  could not pass under D5; the plan's "must pass unchanged" bullet was
  unsatisfiable. That one case was rewritten (user-approved). L-032.
- **Step 7:** ESLint rejected the prescribed `state.conflicts ?? []` boot guard
  as dead per the type. Resolved by typing the stored shape separately
  (`StoredOutboxState`, `conflicts?`), not by dropping the guard or disabling the
  rule. `version: 1` was never bumped (L-030).
- **Step 8:** the first resolver polled a 100 ms `setInterval` for its budget
  reset — never cleared; replaced by an `effect()` on `pendingCount`. And the
  resolver reloads on every call, i.e. per **op**, where D6 said per snapshot —
  the source of A7's gap.
- **Step 8 (out of scope, shipped here — AD-031):** an intermittent `ENOENT`
  turned out to be a `FileStore` bug — `flushAll()` could not await a debounced
  write already in flight — affecting seven test files. Two test-level fixes
  failed before the root cause was found (L-033). Fixed in `FileStore`, plus a
  shutdown try/catch so a failed flush cannot hang SIGTERM. Own commit
  (`912972c`).
- **Process:** an interrupted agent left D10 deliberately broken in the source
  (L-034); count-only verification hid a red server suite for six steps (L-031).
- **Step 11** ran as one browser profile, not two (still valid: the conflict came
  from each tab's in-memory card). Step 12's phone run covered independent
  storage.

## Discovered

- **(2026-10-15) The resolver's reload budget is per drain pass, so a stale
  queue with 3+ conflicting cards parks the rest.** Every `resolve()` reloads and
  increments `reloadsThisPass`, which resets only when the queue empties; the
  third conflict returns `'reload budget exhausted'` and is parked — never
  retried, scheduling never applied — though its 409 body already carries the
  server card. The bound saves no limiter budget (one 409 per conflicting op
  either way; reloads are 2xx). Fix per D6: reload once per snapshot, bound
  re-applies per op. Open Quick Task, `specs/STATE.md` 2026-10-15; AD-030
  amended.
- **(2026-10-11) `FileStore` in-flight writes** — see "What changed" and AD-031.
  `import/run.ts`'s bare `flushAll()` was left alone: one-shot, and Express 5
  forwards async route rejections, so hard-failing is correct there.
- **(2026-10-11, C-6) The revlog-id set's completeness is now a correctness
  input.** After D5 it decides whether a replay may write. A trimmed set makes a
  forgotten replay fall to the precondition and be rejected — a spurious
  conflict, not a clobber — but whoever builds 023's "retain last N ids" trim
  should know.
- **(2026-10-11) `POST /collection/resume` moves `due` without touching `rev` or
  `modified`** (`routes/index.ts:78`), so a resume is invisible to the
  precondition. Accepted for now (desktop-only; re-apply never trusts a stale
  card) — a genuine hole for whatever revisits this.
- **(2026-10-11) Presence signalling was declined**; the conflict counter
  (`OutboxService.conflictCount`) is the instrument that would justify it.
- **(2026-10-14) A stale 023 poison op** (`PATCH /cards/does-not-exist`, 404,
  2026-09-18) sat in the dev browser's `localStorage` and showed "1 review could
  not be saved" during Step 11. Not a 024 defect; poisoned ops are never
  auto-deleted by design.
