# CRITIQUE: 008-listening-comprehension-card
- **Mode:** drift
- **Date:** 2026-07-13
- **Verdict:** PASS

## Findings

Audited SPEC reqs 1–13, the four resolved OQs, all non-goals, migration
idempotency, and scope — against the actual working-tree code and a full test
run (server 32/32, web 183/183 passing).

Requirements satisfied by real code, not just claimed:
- Req 1–4: `LISTENING_TEMPLATE` (seed.ts:43–48) is ord 1 name "Listening",
  qfmt `{{SideAAudio}}{{SideBAudio}}` only, afmt reveals SideA/SideB
  text+image+audio with no `{{FrontSide}}`. Pushed into `nt-spanish-2sided`
  templates after ord-0 "A → B" (seed.ts:212–220). Web model mirror unchanged
  (shapes already match). seed.test.ts + T004 renderer test assert front
  audio-only / back full.
- Req 5–8: `migrateAddListeningTemplate` (migrations.ts) appends the template
  only when ord 1 absent, reconciles each `nt-spanish-2sided` note lacking an
  ord-1 card into a fresh "new" card in the note's own deck, and places
  positions past `nextNewPosition` (test asserts due 6,7 past max 5).
  Wired into `FileStore.init` (file-store.ts) with notetypes-then-cards flush
  order.
- Req 7: migrations.test.ts + file-store.migration.test.ts assert ord-0
  ease/interval/due/queue/type byte-preserved and a second init adds no cards
  and no duplicate ord-1 — genuinely idempotent and scheduling-preserving.
- Req 9–13: review.ts `afterRenderEffect` (114–162) plays audios sequentially,
  chaining on `ended`, swallowing `play()` rejections, tearing down on card
  change. Gated on `noteType.id === 'nt-spanish-2sided' && template.name ===
  'Listening'` (review.ts:206) — NOT on "audio present". review.spec asserts
  autoplay for ord-1, chain on `ended`, and no `play()` for ord-0 A→B or cloze,
  plus no type-input on the Listening card (closes the prior plan-mode req-12
  WARN).

OQ resolutions all match the build: (1) programmatic `.play()` chained on
`ended` in review.ts only; (2) visible `<audio controls>` fallback, no front
text; (3) back-to-back (no delay in `ended` handler); (4) no special new-card
handling.

Non-goals honoured: no new note type (template on existing type); no
scraping/content/importer change; no `{{type:}}` grading; no scheduling-math
change; `transformMedia` and the A→B render/play/schedule path are untouched
(template-renderer.ts production code has zero diff — only its .spec grew).

Scope: the two flagged-but-expected deltas are acceptable, not drift —
(a) transform.test.ts updated to expect 2 cards is a necessary consequence of
the seed change, logged in STATE Discovered; (b) the in-vivo migration of
data/spanish (notetypes gained Listening; cards gained 3638 ord-1 "new" cards
against 3638 ord-0) is the feature's own migration firing on the dev store,
logged and consistent. No touched file falls outside PLAN's "Files affected".

1. **[NIT]** review.spec req-12 check asserts the absence of `.type-input` in
   the DOM rather than `state().isListeningFront`/`isTypeIn` directly; adequate,
   no action required.
