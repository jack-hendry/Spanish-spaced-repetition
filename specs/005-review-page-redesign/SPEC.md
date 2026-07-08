# SPEC — 005-review-page-redesign

## Problem

The study/review page (`web/src/app/features/review/`) diverges from the
approved mockups. Two gaps matter most to the user: (1) the four grading
buttons (Again/Hard/Good/Easy) are hidden until the answer is revealed,
where the mockup shows them always present but greyed-out pre-reveal, so
the layout jumps on reveal; and (2) the page chrome is missing pieces the
mockup shows — a queue-status legend (New/Learning/Review counts), a
full-width top progress bar, a note-type chip on the card, a "Show answer"
pill with an inline "space" key chip, and an updated keyboard hint line.
The mockups use a Biology cloze card as illustrative content only; layout
and behaviour are what must match.

## Goals

- Match the two mockup states (question-only, answer-revealed) in layout,
  hierarchy, and colour roles, using the app's existing dark theme tokens.
- Keep the grading row permanently visible; dimmed and inert before reveal,
  active after.
- Space reveals the answer; 1–4 grade after reveal; Esc exits the session.
- No behaviour change to scheduling, queueing, or persistence.

## Non-goals (out of scope)

- No changes to scheduling math, `StudyQueueService` ordering, daily
  limits, burying, or suspend logic. `Scheduler.preview()` already supplies
  per-rating interval labels; consume it as-is.
- No server or data-model changes. No API changes.
- No changes to other pages (deck list, browse, stats, options) or to the
  global theme tokens beyond what this page consumes.
- No redesign of type-in (`{{type:}}`) card mechanics — the input, its
  Enter-to-reveal behaviour, and answer diffing stay functionally as they
  are; only surrounding chrome restyles.
- No removal of existing features not shown in the mockup (Suspend, back
  link, "All done" state) — they are restyled to fit, not cut.
- No animations beyond simple opacity/width transitions already in use.
- No mobile-specific layout work beyond keeping the current responsive
  behaviour non-broken.

## Requirements

### Page chrome

1. A thin (~4px) progress bar spans the **full width of the page at the
   very top**, filled left-to-right in the accent blue proportional to
   session progress (`answeredCount / sessionTotal`, as today). It moves
   out of the topbar's session-info block.
2. The session title reads "{deck} — {n} of {total}" (existing
   `deckName()`, `sessionN()`, `sessionTotal()`), displayed as the page's
   header line, centered per the mockup.
3. A centered **status legend** appears near the top showing three items,
   each a small colored square plus label and count: blue "New {n}", red
   "Learning {n}", green "Review {n}". Counts come from the existing
   `counts` signal (`QueueCounts`) and update after every graded card.

### Card panel

4. The card is a single centered panel (~700px max width) on a surface
   lighter than the page background, with large rounded corners, soft
   shadow, and generous padding. Question/answer content, breadcrumb, and
   chip all live inside this one panel (today the breadcrumb sits outside
   the rendered surface).
5. The panel's top line is a small uppercase muted breadcrumb of the deck
   path — full `::` hierarchy rendered with "·" separators (e.g.
   "SPANISH · CHAPTER 1"), replacing today's leaf-name-plus-tags line —
   followed by a small rounded **outlined chip naming the note type kind**
   (e.g. "CLOZE"; see Open questions for the standard-type label).
6. Question text renders large, bold, high-contrast. On reveal, a thin
   horizontal divider separates question from answer; answer text is
   regular weight in a lighter muted tone. The existing `<hr id="answer">`
   restyling approach may satisfy this — the requirement is the visual
   result, not the mechanism.

### Show-answer and grading controls

7. Pre-reveal, a prominent **solid accent-blue filled pill** labelled
   "Show answer" appears below the card, with a small darker-blue "space"
   key chip inside it, right-aligned. Clicking it (or pressing Space)
   reveals the answer. It disappears (or is replaced) once revealed.
8. The four grading buttons render **in both states**: equal width in one
   row, dark fill, subtle colored border and colored label per rating
   (Again red, Hard orange/amber, Good green, Easy blue), each stacking
   label / muted interval preview / small key number 1–4. Interval
   previews (from `preview[rating].label`) are visible in both states.
9. Pre-reveal the grading buttons are **dimmed (reduced opacity), still
   legible, and non-interactive** — clicks and keys 1–4 must not grade
   before reveal. They must be excluded from keyboard focus and announced
   as disabled to assistive tech (e.g. `disabled` attribute). Post-reveal
   they return to full opacity and become interactive. The reveal must
   not shift the buttons' position (no layout jump).
10. The hint line below the buttons reads "space to flip · 1–4 to grade ·
    esc to exit" per the mockup (see Open questions on suspend's mention).

### Keyboard

11. Space reveals the answer when unrevealed (unchanged: on type-in cards
    Space types into the input and Enter reveals). Keys 1–4 grade only
    after reveal (unchanged). Existing post-reveal Space/Enter = Good and
    "-" = suspend shortcuts are preserved.
12. **Esc exits the study session**, navigating back to the deck list
    (`/`). Esc must not fire mid-grade side effects; an in-flight `rate()`
    completing after navigation must not error.

### Integrity

13. All existing review-flow behaviour is preserved: optimistic card
    update, `/api/review` POST, daily-tally recording, sibling burying,
    suspend, the loading and "All done" states, and session counters.
14. Existing web unit tests still pass; any test asserting the old DOM
    (e.g. ratings only rendered post-reveal) is updated to the new
    contract rather than deleted.

## Open questions

1. **Chip label for non-cloze cards** — the mockup only shows "CLOZE".
   For standard note types, show the note-type kind ("STANDARD"?), the
   note-type name, or the template name? Proposal: the kind, uppercased.
2. **Suspend affordance** — the mockup hint omits "− suspend" and shows no
   Suspend button. Keep the topbar Suspend button and append "· − suspend"
   to the hint, or hide suspend from the visible UI (keyboard-only)?
   Proposal: keep both button and hint mention; mockup silence is not a
   removal request.
3. **Back link** — the mockup shows no "← Decks" link (Esc now covers
   exit). Keep it in the topbar or drop it? Proposal: keep, restyled
   unobtrusively, since Esc is undiscoverable on touch devices.
4. **Legend colours vs button colours** — the mockup uses blue for "New"
   and blue for "Easy", red for "Learning" and red for "Again". Confirm
   the legend should reuse the same accent tokens (Anki convention:
   new=blue, learning=red/orange, review=green). Assumed yes.
5. **Pre-reveal Space on type-in cards** — mockup says "space to flip",
   but Space must keep typing into the input on type-in cards. Assumed
   the existing Enter-to-reveal exception stands; confirm the hint text
   need not vary per card type.
