# CriticReview — 012 clamp learning steps / `due: NaN`

Two harden rounds, as `CLAUDE.md` requires for a **Large** task. Round 1
checked the plan against the source; Round 2 checked the edge cases and the
type contract. A third review is still owed *after* coding.

Per `specs/TEMPLATE.md`: "a plan can be perfectly consistent with itself and
still wrong about the code" — so every assumption below was confirmed by
opening the file, not by re-reading the plan.

---

## Round 1 — plan vs. source

### Verified

| Assumption in the plan | How it was checked | Result |
|---|---|---|
| The four `curLeft` lines exist verbatim as written in the `Do` blocks | `grep -n "card.left \|\| steps.length"` on both files | ✅ `sm2.ts:131,158`, `fsrs.ts:145,177` — all four exact |
| Every step carries a `Model:` field | The template's gate: `steps=8`, `models=8`, non-zero | ✅ PASS |
| `sm2.spec.ts` `opts()` takes `Partial<DeckOptions>` while `fsrs.spec.ts` `opts()` takes `Partial<DeckOptions['fsrs']>` | Read both helper signatures (`sm2.spec.ts:12`, `fsrs.spec.ts:26`) | ✅ Confirmed — they differ. Called out as a **Trap** in Steps 3 and 5 so the executor cannot copy the wrong call shape |
| `study-queue.service.spec.ts` already has fixtures making `left: 3` a stale value with no new setup | `deckOptions.new.steps` is `[1, 10]` (`:38`) | ✅ Confirmed — no fixture work needed in Step 7 |
| Baseline counts | `npm run test -w web` = 187, `-w server` = 38 | ✅ Both current as of this spec |

### Defect found and fixed — F1 (would have broken Step 7)

Step 7 originally said "follow the existing `setup()` helper's shape", implying
it could be called. `setup()` is declared **inside**
`describe('StudyQueueService pause gate')` (`study-queue.service.spec.ts:102`),
so it is not in scope for a sibling `describe`. The step would have failed on
an undefined reference.

Fixed: Step 7 now carries the literal six-line local `setup()` to declare
inside the new block, plus an explicit trap note that `collection()`, `deck()`,
`deckOptions`, `card()` and `ctx` *are* module-scoped and reusable but
`setup()` is not. This is exactly the class of defect the template's critic
rule exists to catch (cf. L-018).

### Defects found and fixed — F2, F3 (cosmetic but misleading)

- **F2:** Step 6 said "the five this spec owns" and then listed six files, and
  did not say that `study-queue.service.spec.ts` legitimately appears only
  *after* the checkpoint. An executor could have read the mismatch as "a file
  escaped scope" and stopped. Corrected to six, with the Step 7 note.
- **F3:** Step 6's `clampLeft` grep check was vague ("4 call sites plus the
  definition plus imports plus spec references") — unverifiable as written.
  Replaced with exact counts: `grep -c` returns **3** for `sm2.ts` and **3**
  for `fsrs.ts`, and `grep -rln` must list exactly four files.

---

## Round 2 — arithmetic, edge cases, and the type contract

### The clamp was verified by execution, not by reasoning

`clampLeft` and the downstream index math were run standalone in `node`:

```
clampLeft(0,3)=3  clampLeft(NaN,3)=3  clampLeft(2,3)=2
clampLeft(3,1)=1  clampLeft(-2,3)=1   clampLeft(3,2)=2
```

and the resulting scheduler branches:

| steps | `left` | clamped `curLeft` | `hard` index/delay | `good` |
|---|---|---|---|---|
| `[1]` | 3 | 1 | 0 → 1m | graduate |
| `[1,10]` | 3 | 2 | 0 → 1m | step idx 1 = 10m, `left` 1 |
| `[1,10]` | new | 2 | 0 → 1m | step idx 1 = 10m, `left` 1 |
| `[1,10]` | 1 | 1 | 1 → 10m | graduate |

**The bottom two rows are the R1 proof.** They reproduce, exactly, the two
existing passing tests — `'Good on a new card advances to the second learning
step (10m)'` and `'Good on the last learning step graduates (1d)'` — so the
clamp provably does not alter the common path. This is stronger evidence than
"the suite still passes", because it shows *why* it passes.

The R3 correction made to `Analyst.md` before `tasks.md` was written is also
confirmed by row 1: clamping to a single remaining step makes `good`
**graduate**, not step. The original R3 claimed the opposite.

### Edge cases examined

- **`stepCount` can never be 0.** All four call sites guard the array first
  (`sm2.ts:130,157`, `fsrs.ts:144,176` — `steps.length ? … : [1]` / `[10]`), so
  `clampLeft` is never called with 0. Worth stating because `clampLeft(x, 0)`
  *would* return 0 and re-open the out-of-bounds read. **Decision: do not add
  defensive code for an unreachable input** — it would be untestable and would
  imply a guarantee the helper does not actually make. The guard belongs where
  it already is. Flagged here so a future reader who moves the helper knows the
  precondition it relies on.
- **`NaN` self-heals.** `NaN || stepCount` → `stepCount`, so a card whose `left`
  was already corrupted to `NaN` by the pre-fix bug is repaired on its next
  review rather than staying stuck. Not a stated requirement, but a genuine
  bonus worth keeping — Step 1's spec pins it so it cannot be refactored away.
- **`left` is `number`, not `number | null`.** Confirmed in
  `web/src/app/core/models/index.ts:76` and its mirror
  `server/src/models/index.ts:99`. So `clampLeft(left: number, …)` is the
  correct signature and needs no nullable handling. The two model files agree,
  so the `CLAUDE.md` "change both or neither" contract is not engaged — this
  spec changes neither.
- **`interval` on a learning outcome.** Step 3's finiteness assertion covers
  `r.card.interval`, which `learningStep` does not set — it inherits the
  card's existing `0`. `Number.isFinite(0)` is `true`, so the assertion is
  valid rather than vacuous.

### Scope check against the Analyst's non-goals

| Non-goal | Honoured? |
|---|---|
| No `server/` change | ✅ No step touches `server/` |
| No on-disk shape change | ✅ No model file edited |
| No `data/spanish/` repair pass | ✅ Confirmed 0 corrupted cards in 7,276; Step 6 only *reverts* accidental dev-server churn (L-002) |
| No Options-page validation feature | ✅ Not in any step |
| No change to `again`/`easy` branches | ✅ Only the `curLeft` derivation changes; both branches are untouched and are covered by the finiteness assertions |
| No FSRS math / `MIN_EASE` change | ✅ Explicit `DO NOT TOUCH` in Steps 2 and 4 |
| One rule, not four ad hoc patches | ✅ Single shared `clampLeft`; Step 6 greps to prove there is no fifth variant |

### Residual risk accepted

- **A fifth call site added later would not be protected.** Nothing forces a
  future `previewX` to use `clampLeft`. Mitigated only by the helper's doc
  comment and the `scheduling-domain` lesson Step 8 adds. A lint rule would be
  overkill for two files.
- **The red/green proof depends on `git stash`.** Steps 3, 5 and 7 each stash a
  single source file to prove the new tests fail without the fix. If the
  working tree has unrelated staged changes to that same file, the stash could
  pull in more than intended. Low risk here (the tree is clean apart from this
  spec's own files), and each step re-runs the suite after `stash pop` to
  confirm the count returns to green.

---

## Verdict

`tasks.md` is ready to execute after F1-F3 were fixed. F1 was a genuine
run-stopper; F2 and F3 would have caused a false stop rather than a wrong
result.

Round 3 (post-coding review) still owed, per the Large-task rule.
