# STATE: 002-spanish-vocab-apkg-import

## Status
- **Phase:** done   <!-- specify | plan | implement | done -->
- **Current task:** none (all tasks complete)
- **Last updated:** 2026-07-06

## Original request
> /Users/jhend/Downloads/10000_Spanish_Vocabulary_Part_1_of_3.apkg I want you to extract the contents of this file.  I am expecting there to be a spanish and english phrase, as well as an english and spanish audio.  We have a file that will help with this. @tools/convert_apkg.py

## Completed
- [x] Spec written
- [x] Spec approved (human)
- [x] Plan written
- [x] Plan approved (human)
- [x] T001: Read model definitions + note model id
- [x] T002: Field mapping + example-sentence assembly for the Spanish model
- [x] T003: Dual-audio resolve-and-copy helper
- [x] T004: Model-dispatched main loop + counters + noteType `spanish2`
- [x] T005: Derive title/slug from the deck (drop phrasal-verbs default)
- [x] T006: Full converter run on the real apkg + output verification
- [x] T007: Import + reconcile verification

## Decisions log
- 2026-07-06: Feature initiated. Inspected the .apkg before spec: 3639 notes,
  3638 in model "Spanish Vocabulary Practice" (fields: Spanish, English,
  Spanish Sentence, Cloze Sentence, English Sentence, Image, Vocab Audio,
  Sentence Audio) + 1 stray "Basic" note. Both audio fields are Spanish
  azure-TTS clips (vocab word + example sentence); there is NO English audio,
  contradicting the request's "english and spanish audio" expectation.
- 2026-07-06: SPEC.md written by spec-writer (~106 lines). Grounded in the
  importer: transform.ts reads only SideA/SideB/SideAAudio/SideBAudio/
  SideAImage/SideBImage and requires /media/… or http(s) audio paths;
  seed.ts noteType "spanish2both" = 2 templates (2 cards/note, ~7276),
  "spanish2" = 1 card/note (~3638). Six load-bearing decisions surfaced as
  OPEN QUESTIONS with recommended defaults: (1) no-English-audio discrepancy,
  (2) mapping word+sentence audio onto the two audio slots, (3) which side is
  the study front, (4) single vs both directions, (5) whether to include
  example sentences, (6) the 1 stray Basic note. Phase advanced to plan;
  awaiting human review of SPEC + the open questions before planning.
- 2026-07-06: Human approved SPEC at the gate and confirmed all six open
  questions (all recommended defaults — see "Resolved open questions").
  Phase advanced to implement pending PLAN.md; delegating to planner.
- 2026-07-06: PLAN.md written by planner (7 tasks, T001-T007). Confirmed via
  template-renderer.ts that card templates substitute field values UNESCAPED,
  so example sentences can be appended inline with `<br>` in SideA/SideB with
  no note-type/template change (out of scope). Only file to be modified:
  tools/convert_apkg.py. Awaiting human plan-approval gate before T001.
- 2026-07-06: T001 implemented. Notes query changed to
  `SELECT id, mid, flds FROM notes ORDER BY id` (mid read but not yet used for
  dispatch); added `load_models(conn)` reading `col.models` JSON into
  `{mid_str: {"name": ..., "fields": {field_name: ord}}}`; called in
  `convert()` and held in local `models`. Verified against the real apkg with
  a scratchpad script (deleted after use): model "Spanish Vocabulary Practice"
  field map = Spanish->0, English->1, Spanish Sentence->2, Cloze Sentence->3,
  English Sentence->4, Image->5, Vocab Audio->6, Sentence Audio->7 (exact
  match); "Basic" model also present with Front->0, Back->1. Existing
  Front/Back positional loop body left unchanged; syntax-checked the file.
  No full converter run performed (deferred to T006 per plan).
- 2026-07-06: T002 implemented. Added `build_spanish_card_fields(fields,
  field_map)` to tools/convert_apkg.py (before `convert()`): looks up Spanish/
  English/Spanish Sentence/English Sentence/Vocab Audio/Sentence Audio by name
  via a local strip-and-tolerate-missing `field()` helper; returns `None` when
  both Spanish and English are empty (skip signal); else returns
  `(side_a, side_b, vocab_audio_raw, sentence_audio_raw)` where sides append the
  example sentence as `"<word><br><sentence>"` only when the sentence is
  non-empty, and audio values are returned raw (no `[sound:]` extraction — that
  is T003). Not yet wired into `convert()` (T004). Verified with a scratchpad
  script (deleted) on 5 real notes: trimmed text, sentence on a `<br>` second
  line, both raw `[sound:...]` values; edge cases confirmed (blank sentence = no
  `<br>`; both-empty = `None`). py_compile clean; only convert_apkg.py changed.
- 2026-07-06: T003 implemented. Refactored the inline sound extraction/copy
  logic out of `convert()`'s loop into `resolve_audio(raw_value,
  filename_to_number, tmp)` -> `(path, copied)`: runs `SOUND_RE.search` on the
  single passed value, resolves via the media map, copies into MEDIA_DIR with
  the existing `"{number}-{slug}.mp3"` naming, returns `/media/<name>` (or
  `None`) plus a `copied` bool for counting. Guards None/empty/no-match/unknown-
  filename/missing-source — all return `(None, False)` without raising. Existing
  Front/Back loop rewired to call the helper (still joins fields; per-field
  dispatch is T004), counters preserved. Verified on a real Vocab Audio value:
  returned `/media/2801-azure-...mp3`, copied=True, file present on disk
  (23328 bytes); all four unresolvable cases returned `(None, False)`.
  py_compile clean; only convert_apkg.py changed.
- 2026-07-06: T004 implemented. `convert()` main loop now dispatches per note by
  model name via the `load_models` map: "Spanish Vocabulary Practice" ->
  `build_spanish_card_fields` (skip on both-empty) + two independent
  `resolve_audio` calls (Vocab Audio -> SideAAudio, Sentence Audio -> SideBAudio),
  images None; "Basic" -> skipped + logged once; any other model -> unchanged
  positional Front/Back + single-audio path (preserves phrasal-verbs). Emitted
  `book["noteType"]` changed "spanish2both" -> "spanish2". Summary extended with
  matched/skipped(basic+empty)/copied/missing counts. Verified end-to-end on the
  real apkg (explicit --title/--slug flags used, since deriving them is T005):
  `[convert] skipping 1 Basic note` / wrote 3638 cards / matched 3638 / skipped 1
  (1 Basic, 0 empty) / copied 7276 media files. noteType in JSON = "spanish2";
  all cards have non-empty SideA/SideB and both /media audio paths; 3 spot-checked
  clips exist on disk; `_index.json` row added. No unresolved-audio misses on this
  deck. py_compile clean; only convert_apkg.py changed.

- 2026-07-06: T005 implemented. Added `pick_deck_name(conn)` (reads `col.decks`
  JSON, drops "Default", picks the non-Default deck with the most notes, tie-break
  by ascending deck id). Wired into `convert()`: when `--title`/`--slug` are
  omitted, derive from the deck name via `slugify()`; explicit flags still
  override. Removed the hardcoded phrasal-verbs title + filename-slug fallback from
  `main()`. Verified with a flag-less real run. IMPORTANT FINDING: the apkg's
  embedded deck name is `Spanish Practice Vocabulary::Spanish Practice Vocabulary
  Part 1` (Anki nested-deck syntax), NOT the canonical target. Derivation is
  correct but the derived slug is
  `spanish-practice-vocabulary-spanish-practice-vocabulary-part-1` (ugly/duplicated
  segment). Per PLAN, T006 must pass explicit
  `--title "10000 Spanish Vocabulary (Part 1 of 3)"
  --slug 10000-spanish-vocabulary-part-1-of-3`. py_compile clean; only
  convert_apkg.py changed.

- 2026-07-06: T006 done (verification; no code change). Removed the stray T005
  source file + its `_index.json` row, then ran the converter with explicit
  `--title "10000 Spanish Vocabulary (Part 1 of 3)"
  --slug 10000-spanish-vocabulary-part-1-of-3`. Result: 3638 cards, 1 Basic
  skipped, 7276 media copied. Verified generated JSON: card count exactly 3638,
  noteType "spanish2", 0 empty SideA/SideB, 0 null SideAAudio/SideBAudio (all
  `/media/...`), 3 spot-checked cards' 6 audio files present on disk (20–41 KB).
  Sample: SideA `"el color<br>El color es hermoso."`, SideB
  `"color<br>The color is beautiful."`. `_index.json` valid, exactly one canonical
  row, no stray row. Cleanup item in Discovered is now RESOLVED.

- 2026-07-06: T007 done (integration verification; no code change). First
  `npm run import`: 3220->3221 decks, 45498->49136 notes, 49243->52881 cards
  (+1 deck / +3638 notes / +3638 cards, exact). New deck id `dec724d1698056083`,
  name "10000 Spanish Vocabulary (Part 1 of 3)", parentId null; its 3638 notes use
  notetypeId `nt-spanish-2sided` (= `NOTE_TYPE_IDS.spanish2`), confirming noteType
  recognition. Re-ran converter + `npm run import` a second time: global totals
  IDENTICAL, same deck id reused (not recreated), 3638 cards / 3638 distinct guids
  unchanged, `_index.json` still one row — reconcile-in-place via `(slug, Card_ID)`
  guids confirmed, no duplication/loss. `npm run test -w server`: 17/17 pass, no
  regressions.

## FEATURE COMPLETE (2026-07-06)
Made `tools/convert_apkg.py` model-aware so Anki .apkg decks with the "Spanish
Vocabulary Practice" model import correctly. Notes are dispatched by model name:
the Spanish model maps by field NAME (Spanish->SideA, English->SideB, each with
its example sentence appended inline via `<br>`), with dual Spanish audio (Vocab
Audio->SideAAudio, Sentence Audio->SideBAudio) resolved+copied to
`data/spanish/media/` as `/media/...` paths; the stray "Basic" note is skipped and
logged; any other model keeps the legacy positional Front/Back path (phrasal-verbs
unaffected). Emits `noteType: "spanish2"` (one card/note). Title/slug now derive
from the apkg deck name (explicit flags override). End-to-end: the real 3639-note
apkg converts to 3638 cards (1 Basic skipped) + 7276 media clips, imports to a new
deck, and re-import reconciles in place. Only `tools/convert_apkg.py` was modified.

## Discovered
- Example-sentence context is represented as an inline `<br>` in the side text;
  safe because template-renderer.ts inserts field values without HTML escaping.
  Fallback to a plain newline if a build-time check shows escaping.
- [RESOLVED in T006] The T005 flag-less run left a stray second source file
  `spanish-practice-vocabulary-...json` + its `_index.json` row. T006 deleted the
  file and removed the row; only the canonical `10000-...` pair now remains.
- apkg deck names use Anki's `::` hierarchy separator, which is ALSO this app's
  hierarchical-deck separator (per CLAUDE.md). Not acted on; potential future work
  if apkg-derived titles should map onto the app's deck hierarchy rather than
  flattening into a single deck name/slug.

## Resolved open questions (human-confirmed 2026-07-06)
1. No English audio — import the two Spanish clips as-is; do not synthesise.
2. Front side — **Spanish front** (SideA=Spanish, SideB=English).
3. Directions — **one direction**, `noteType: "spanish2"` (~3638 cards).
4. Audio — **both clips**: Vocab Audio → SideAAudio, Sentence Audio → SideBAudio.
5. Example sentences — **include as context** (Spanish Sentence on Spanish side,
   English Sentence on English side).
6. Stray "Basic" note — **skip + log** (do not map into Front/Back).

## Next action
None — feature complete (all T001–T007 done, phase=done).

## Blockers
None
