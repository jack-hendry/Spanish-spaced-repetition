// Initial seed content written when data/spanish is first initialised.

import type {
  CardTemplate,
  Collection,
  Deck,
  DeckOptions,
  NoteType,
} from '../models/index.js';

export const SCHEMA_VERSION = 1;

export const DEFAULT_DECK_OPTIONS_ID = 'opts-default';

/** Stable id for the dedicated deck that holds all Listening cards. */
export const LISTENING_DECK_ID = 'dec-listening';

// FSRS-5 default parameters (19 weights).
export const FSRS5_DEFAULT_WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
];

const BASIC_CSS = `.card {
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 22px;
  text-align: center;
  color: #1a1a1a;
  background: #ffffff;
}
.card img { max-width: 100%; height: auto; }
hr#answer { margin: 1em 0; border: none; border-top: 1px solid #ddd; }
.type-result { margin: 0.5em 0; }
.type-given, .type-expected {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.1em;
}
.type-expected { margin-top: 0.3em; color: #6b7280; }
.type-result--ok .type-given { color: #16a34a; }
.type-good { color: #16a34a; }
.type-bad { color: #dc2626; text-decoration: underline; }
.type-have { color: #16a34a; }
.type-missing { color: #dc2626; background: #fee2e2; }`;

export const LISTENING_TEMPLATE: CardTemplate = {
  name: 'Listening',
  ord: 1,
  qfmt: '{{SideAAudio}}{{SideBAudio}}',
  afmt: '{{SideA}}{{SideAImage}}{{SideAAudio}}\n<hr id="answer">\n{{SideB}}{{SideBImage}}{{SideBAudio}}',
  // Every Listening card lives in a dedicated deck, not the note's own deck.
  deckId: LISTENING_DECK_ID,
};

/** The single dedicated deck that holds every note's Listening card. */
export function buildListeningDeck(): Deck {
  return {
    id: LISTENING_DECK_ID,
    name: 'Listening',
    parentId: null,
    optionsId: DEFAULT_DECK_OPTIONS_ID,
    collapsed: false,
  };
}

export function buildSeedCollection(now: number): Collection {
  return {
    schemaVersion: SCHEMA_VERSION,
    created: now,
    modified: now,
    dayCutoffHour: 4,
    defaultDeckOptionsId: DEFAULT_DECK_OPTIONS_ID,
    tags: [],
    pausedAt: null,
  };
}

export function buildSeedDeckOptions(): DeckOptions[] {
  return [
    {
      id: DEFAULT_DECK_OPTIONS_ID,
      name: 'Default',
      new: {
        perDay: 20,
        steps: [1, 10],
        graduatingInterval: 1,
        easyInterval: 4,
        startingEase: 2500,
        insertionOrder: 'sequential',
      },
      review: {
        perDay: 200,
        maxInterval: 36500,
        easyBonus: 1.3,
        intervalModifier: 1.0,
        hardInterval: 1.2,
      },
      lapse: {
        steps: [10],
        newIntervalPct: 0.0,
        minInterval: 1,
        leechThreshold: 8,
        leechAction: 'suspend',
      },
      display: {
        newGatherOrder: 'deck',
        newSortOrder: 'orderGathered',
        reviewOrder: 'dueRandom',
        buryNewSiblings: true,
        buryReviewSiblings: true,
        buryInterdaySiblings: true,
      },
      scheduler: 'sm2',
      fsrs: {
        desiredRetention: 0.9,
        weights: FSRS5_DEFAULT_WEIGHTS,
        maxInterval: 36500,
        learningSteps: [1, 10],
        relearningSteps: [10],
      },
    },
  ];
}

/** Stable ids for the built-in note types so the importer can reference them. */
export const NOTE_TYPE_IDS = {
  basic: 'nt-basic',
  basicReversed: 'nt-basic-reversed',
  basicTypeIn: 'nt-basic-typein',
  cloze: 'nt-cloze',
  spanish2: 'nt-spanish-2sided',
  spanish2both: 'nt-spanish-2sided-both',
} as const;

export function buildSeedNoteTypes(): NoteType[] {
  return [
    {
      id: NOTE_TYPE_IDS.basic,
      name: 'Basic',
      kind: 'standard',
      fields: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
      ],
      templates: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '{{Front}}',
          afmt: '{{FrontSide}}\n<hr id="answer">\n{{Back}}',
        },
      ],
      css: BASIC_CSS,
    },
    {
      id: NOTE_TYPE_IDS.basicReversed,
      name: 'Basic (and reversed)',
      kind: 'standard',
      fields: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
      ],
      templates: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '{{Front}}',
          afmt: '{{FrontSide}}\n<hr id="answer">\n{{Back}}',
        },
        {
          name: 'Card 2',
          ord: 1,
          qfmt: '{{Back}}',
          afmt: '{{FrontSide}}\n<hr id="answer">\n{{Front}}',
        },
      ],
      css: BASIC_CSS,
    },
    {
      id: NOTE_TYPE_IDS.basicTypeIn,
      name: 'Basic (type in the answer)',
      kind: 'standard',
      fields: [
        { name: 'Front', ord: 0 },
        { name: 'Back', ord: 1 },
      ],
      templates: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '{{Front}}\n{{type:Back}}',
          afmt: '{{FrontSide}}\n<hr id="answer">\n{{type:Back}}',
        },
      ],
      css: BASIC_CSS,
    },
    {
      id: NOTE_TYPE_IDS.cloze,
      name: 'Cloze',
      kind: 'cloze',
      fields: [
        { name: 'Text', ord: 0 },
        { name: 'Back Extra', ord: 1 },
      ],
      templates: [
        {
          name: 'Cloze',
          ord: 0,
          qfmt: '{{cloze:Text}}',
          afmt: '{{cloze:Text}}\n<hr id="answer">\n{{Back Extra}}',
        },
      ],
      css: BASIC_CSS + '\n.cloze { font-weight: bold; color: #2563eb; }',
    },
    {
      // Produced for the McGraw Hill import: two-sided cards with optional media.
      id: NOTE_TYPE_IDS.spanish2,
      name: 'Spanish 2-sided',
      kind: 'standard',
      fields: [
        { name: 'SideA', ord: 0 },
        { name: 'SideAAudio', ord: 1 },
        { name: 'SideAImage', ord: 2 },
        { name: 'SideB', ord: 3 },
        { name: 'SideBAudio', ord: 4 },
        { name: 'SideBImage', ord: 5 },
      ],
      templates: [
        {
          name: 'A → B',
          ord: 0,
          qfmt: '{{SideA}}{{SideAImage}}{{SideAAudio}}',
          afmt: '{{FrontSide}}\n<hr id="answer">\n{{SideB}}{{SideBImage}}{{SideBAudio}}',
        },
        LISTENING_TEMPLATE,
      ],
      css: BASIC_CSS,
    },
    {
      // Like spanish2 but generates both study directions (A→B and B→A). Used
      // for imports of two-way decks (e.g. Anki phrasal-verb packs). Audio lives
      // on SideA, so it plays on the A→B question and on the B→A answer.
      id: NOTE_TYPE_IDS.spanish2both,
      name: 'Spanish 2-sided (both ways)',
      kind: 'standard',
      fields: [
        { name: 'SideA', ord: 0 },
        { name: 'SideAAudio', ord: 1 },
        { name: 'SideAImage', ord: 2 },
        { name: 'SideB', ord: 3 },
        { name: 'SideBAudio', ord: 4 },
        { name: 'SideBImage', ord: 5 },
      ],
      templates: [
        {
          name: 'A → B',
          ord: 0,
          qfmt: '{{SideA}}{{SideAImage}}{{SideAAudio}}',
          afmt: '{{FrontSide}}\n<hr id="answer">\n{{SideB}}{{SideBImage}}{{SideBAudio}}',
        },
        {
          name: 'B → A',
          ord: 1,
          qfmt: '{{SideB}}{{SideBImage}}{{SideBAudio}}',
          afmt: '{{FrontSide}}\n<hr id="answer">\n{{SideA}}{{SideAImage}}{{SideAAudio}}',
        },
      ],
      css: BASIC_CSS,
    },
  ];
}
