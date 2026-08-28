# tasks — TypeScript lint audit (Phase 0) — completed run summary

All 12 steps ran sequentially and are **done** (2026-08-28). This is a
post-run summary — the original file carried full per-step instructions
(Files/Context/Do/Done when/If blocked); those are compressed here since the
work is finished. Design rationale lives in [`Analyst.md`](./Analyst.md)
(§4 decisions D1–D6, §6 retrospective); defect-by-defect detail (R1–R15,
L-011, L-012) lives in [`CriticReview.md`](./CriticReview.md). No file under
`web/src/` or `server/src/` was modified by any step, and neither was
`.github/workflows/ci.yml` — the whole run stayed report-only.

---

**Step 1 — Install ESLint + plugin suites at the repo root.** *(haiku)*
Done on attempt 3 after two plan defects: R11 (`typescript` unconstrained at
root → npm resolved `angular-eslint`'s peer to 7.0.2 → `ERESOLVE`) and R12
(`@eslint/js@^10.9.1` doesn't exist — versioned independently of `eslint`).
Both fixed before retrying (Analyst.md D2). Final: `eslint@10.9.1`, root
`typescript@6.0.3`, `server/` kept its own `5.9.3`; diff limited to
`package.json` / `package-lock.json`.

**Step 2 — `eslint.config.mjs` for `server/src` only.** *(haiku)*
`npx eslint server/src` → 101 problems. `projectService: true` worked first
time — the D4 explicit-`project` fallback was never needed.

**Step 3 — Extend to `web/src` TypeScript.** *(haiku)*
→ 140 problems. `projectService` worked again; coverage confirmed across
`core/`, `features/`, and `*.spec.ts`. All four `@angular-eslint` house-style
rules reported 0 — flagged as unverified (clean vs. dead rule) until Step 6.

**Step 4 — Extend to Angular HTML templates.** *(haiku)*
→ 243 total (101 server + 140 web-TS + 2 template `eqeqeq` in
`deck-list.html`). `web/src/index.html` correctly excluded from the template
glob.

**Step 4b — Add three repo-specific rules.** *(haiku)*
`eqeqeq`, `no-restricted-syntax` (bans `.subscribe()`), `no-restricted-imports`
(bans feature-to-feature imports). Added mid-run, before Step 7 froze the
inventory, at the user's request. → 254 total (+11 `eqeqeq`); the two new
rules both report 0, and a false-positive check confirmed
`no-restricted-imports` does not flag `../../core/...` imports.

**Step 5 — Checkpoint: nothing else moved.** *(haiku)*
`npm run build` / `test` / `format:check` all green (280 tests: 71 server,
209 web). Dirty set limited to the expected files; zero paths touched under
`web/src/`, `server/src/`, `.github/`, or `data/spanish/`.

**Step 6 — Verify every roadmap-named rule actually fires.** *(haiku)*
All 8 named rules resolve enabled (171 rules server / 186 web via
`--print-config`). Firing probes (written and deleted) confirmed
`prefer-on-push-component-change-detection`, `no-restricted-imports`, and
`no-restricted-syntax` genuinely fire — closing R14 (a clean codebase and a
dead rule look identical without this check).

**Step 7 — Capture the machine-readable run and aggregate.** *(haiku)*
`total.txt` / `by-rule.txt` / `by-file.txt` all reconcile at 254. Split:
server 102 / web 152. Test files (`*.spec.ts`/`*.test.ts`) carry 140 of 254
(55%) — noted for Phase 1/3 to decide on, not decided here.

**Step 8 — Write `INVENTORY.md`.** *(haiku)*
First pass reported all checks green but its per-rule server/web split
columns were fabricated rather than computed (R15) — caught by the
orchestrator re-verifying, not by the executor's own report. Corrected
version: 25 rows, columns sum to 254 / 102 / 152 with zero mismatches.

**Step 9 — Attribute every violation to a phase.** *(haiku)*
Phase 2: 10 files / 31 violations; Phase 1: 25 / 121; Phase 3: 16 / 102 —
sums exactly to 254/51. Deviation (kept, documented in `INVENTORY.md`):
`collection.store.spec.ts` was pulled into Phase 2 alongside its
implementation file, since leaving it in a Phase 1 batch would let that
batch rewrite the test pinning Phase 2's scheduling code.

**Step 10 — Checkpoint: walk acceptance criteria 1–8.** *(haiku)*
All 8 pass — `npm run lint` reports 254 problems (exit 1, expected); build/
test/format:check green; `INVENTORY.md` complete with no blank/TBD cells;
phase counts match the lint total; all 10 Phase 2 files present by name.

**Step 11 — Tick Phase 0 in the roadmap, log deferrals.** *(haiku)*
All 4 Phase 0 checkboxes ticked; inventory linked. Four dated Discovered
entries added: the Phase 0 landing summary, `eslint-plugin-sonarjs` rejected
in favor of core `complexity`, `angular-eslint`'s `templateAccessibility`
deferred (real work, out of this roadmap's scope), and — most load-bearing —
**TypeScript 7 (the Go port) is an upgrade blocker for the whole roadmap**:
it's the registry's current `latest`, but no `typescript-eslint` release
supports it yet (`>=4.8.4 <6.1.0`), which is why Step 1 pins
`typescript@~6.0.3` at the root.

**Step 12 — Wrap-up: `STATE.md`, retrospective, stop.** *(top-level, because
`protect-spec-docs-from-subagents.sh` denies subagent writes to `Analyst.md`)*
**AD-018** (ESLint adopted report-only, full ruleset from day one, CI gate
deliberately deferred to a directory-at-a-time rollout; supersedes the
2026-08-28 "ESLint deliberately skipped" Quick Tasks position) and **AD-019**
(a durable artifact — the inventory — lives in the folder that outlives the
spec, because the 20 KB archive gate would otherwise force summarizing the
one artifact whose value is its detail) written to `specs/STATE.md`.
**L-011** and **L-012** added as headline + body pairs. `specs/STATE.md` hit
its 300-line budget (298, then 340 with these entries), so the user's
standing pre-authorization to rotate was exercised:
`state_rotate.py --apply` moved AD-010…AD-013 to `STATE-ARCHIVE.md`, leaving
291 lines with all 12 lesson headlines intact. `data/spanish/` clean. Not
committed — left for the user.
