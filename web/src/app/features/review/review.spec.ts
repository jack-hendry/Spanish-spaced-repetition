import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { Component } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { Review } from './review';
import { CollectionStore } from '../../core/collection.store';
import { StudyQueueService, type QueueCounts } from '../../core/study-queue.service';
import { ApiService } from '../../core/api.service';
import { Sm2Scheduler } from '../../core/scheduling/sm2';
import type { Card, Deck, DeckOptions, Note, NoteType } from '../../core/models';

/** Trivial stand-in for the deck-list route Esc navigates to. */
@Component({ selector: 'app-test-stub', template: '' })
class Stub {}

describe('Review', () => {
  const deck: Deck = {
    id: 'd1',
    name: 'Spanish::Chapter 1',
    parentId: null,
    optionsId: 'opt1',
    collapsed: false,
  };

  const noteType: NoteType = {
    id: 'nt1',
    name: 'Cloze',
    kind: 'cloze',
    fields: [{ name: 'Text', ord: 0 }],
    templates: [
      {
        name: 'Cloze',
        ord: 0,
        qfmt: '{{cloze:Text}}',
        afmt: '{{cloze:Text}}',
      },
    ],
    css: '',
  };

  const note: Note = {
    id: 'n1',
    noteTypeId: 'nt1',
    fields: { Text: 'The capital of Spain is {{c1::Madrid}}.' },
    tags: [],
    created: 0,
    modified: 0,
    guid: 'g1',
  };

  function card(overrides: Partial<Card> = {}): Card {
    return {
      id: 'c1',
      noteId: 'n1',
      deckId: 'd1',
      ord: 0,
      type: 'new',
      queue: 'new',
      due: 0,
      reps: 0,
      lapses: 0,
      left: 0,
      lastReviewed: null,
      created: 0,
      modified: 0,
      ease: 2500,
      interval: 0,
      stability: null,
      difficulty: null,
      ...overrides,
    };
  }

  const deckOptions: DeckOptions = {
    id: 'opt1',
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
      weights: [],
      maxInterval: 36500,
      learningSteps: [1, 10],
      relearningSteps: [10],
    },
  };

  const counts: QueueCounts = { new: 3, learning: 1, review: 2 };

  let storeFake: {
    decks: () => Deck[];
    deckById: ReturnType<typeof vi.fn>;
    getNote: ReturnType<typeof vi.fn>;
    noteTypeById: ReturnType<typeof vi.fn>;
    applyCard: ReturnType<typeof vi.fn>;
    recordStudied: ReturnType<typeof vi.fn>;
    burySiblings: ReturnType<typeof vi.fn>;
    suspendCard: ReturnType<typeof vi.fn>;
    collection: () => { dayCutoffHour: number; created: number };
  };
  let queueFake: {
    startAll: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    next: ReturnType<typeof vi.fn>;
    counts: ReturnType<typeof vi.fn>;
    onAnswered: ReturnType<typeof vi.fn>;
    options: DeckOptions | null;
  };
  let apiFake: { submitReview: ReturnType<typeof vi.fn> };
  let answerSpy: ReturnType<typeof vi.spyOn>;

  /** One known card is served the first time next() is called; null after. */
  function seedQueueOneCard(c: Card = card()): void {
    let served = false;
    queueFake.next.mockImplementation(() => {
      if (served) return null;
      served = true;
      return c;
    });
  }

  beforeEach(async () => {
    storeFake = {
      decks: () => [deck],
      deckById: vi.fn((id: string) => (id === 'd1' ? deck : undefined)),
      getNote: vi.fn(async (id: string) => (id === 'n1' ? note : undefined)),
      noteTypeById: vi.fn((id: string) => (id === 'nt1' ? noteType : undefined)),
      applyCard: vi.fn(),
      recordStudied: vi.fn(async () => {}),
      burySiblings: vi.fn(async () => {}),
      suspendCard: vi.fn(async () => {}),
      collection: () => ({ dayCutoffHour: 4, created: Date.now() - 30 * 86_400_000 }),
    };

    queueFake = {
      startAll: vi.fn(() => true),
      start: vi.fn(() => true),
      next: vi.fn(() => null),
      counts: vi.fn(() => counts),
      onAnswered: vi.fn(),
      options: deckOptions,
    };
    seedQueueOneCard();

    apiFake = {
      submitReview: vi.fn(() => of(card())),
    };

    answerSpy = vi.spyOn(Sm2Scheduler.prototype, 'answer');

    await TestBed.configureTestingModule({
      imports: [Review],
      providers: [
        provideRouter([{ path: '', component: Stub }]),
        { provide: CollectionStore, useValue: storeFake },
        { provide: StudyQueueService, useValue: queueFake },
        { provide: ApiService, useValue: apiFake },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(new Map([['deckId', 'd1']])) },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    answerSpy.mockRestore();
  });

  /**
   * The app is zoneless (no zone.js), so `fixture.whenStable()` only tracks
   * Angular's own render scheduling, not the plain-promise chain in
   * `Review.init()`/`loadNext()`. A macrotask flush (all fakes here resolve
   * without real delay) drains that chain before we assert on the DOM.
   */
  async function flushMicrotasks(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function createReview() {
    const fixture = TestBed.createComponent(Review);
    fixture.detectChanges();
    await flushMicrotasks();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  // --- Ratings row (reqs 8, 9, 13) -----------------------------------------

  describe('ratings row', () => {
    it('renders all 4 buttons pre-reveal, disabled, with interval labels visible', async () => {
      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.rate'));
      expect(buttons.length).toBe(4);
      for (const btn of buttons) {
        expect(btn.disabled).toBe(true);
        expect(btn.querySelector('.rate__ivl')?.textContent?.trim().length).toBeGreaterThan(0);
      }
    });

    it('does not grade or call the scheduler/API when a rating button is clicked pre-reveal', async () => {
      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const goodBtn = el.querySelectorAll<HTMLButtonElement>('.rate')[2];
      goodBtn.click();
      fixture.detectChanges();
      await flushMicrotasks();
      fixture.detectChanges();

      expect(answerSpy).not.toHaveBeenCalled();
      expect(apiFake.submitReview).not.toHaveBeenCalled();
    });

    it('enables buttons post-reveal and clicking one grades', async () => {
      const fixture = await createReview();
      const component = fixture.componentInstance;
      component.reveal();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.rate'));
      for (const btn of buttons) expect(btn.disabled).toBe(false);

      buttons[2].click();
      fixture.detectChanges();
      await flushMicrotasks();
      fixture.detectChanges();

      expect(answerSpy).toHaveBeenCalledTimes(1);
      expect(answerSpy.mock.calls[0][1]).toBe('good');
      expect(apiFake.submitReview).toHaveBeenCalledTimes(1);
    });
  });

  // --- Keyboard (reqs 9, 11) ------------------------------------------------

  describe('keyboard', () => {
    function press(key: string): void {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }

    it('reveals on Space when unrevealed', async () => {
      const fixture = await createReview();
      expect(fixture.componentInstance.revealed()).toBe(false);
      press(' ');
      fixture.detectChanges();
      expect(fixture.componentInstance.revealed()).toBe(true);
    });

    it('does nothing for keys 1-4 before reveal', async () => {
      const fixture = await createReview();
      press('3');
      fixture.detectChanges();
      await flushMicrotasks();
      fixture.detectChanges();
      expect(answerSpy).not.toHaveBeenCalled();
      expect(fixture.componentInstance.revealed()).toBe(false);
    });

    it('grades Good when "3" is pressed after reveal', async () => {
      const fixture = await createReview();
      fixture.componentInstance.reveal();
      fixture.detectChanges();

      press('3');
      fixture.detectChanges();
      await flushMicrotasks();
      fixture.detectChanges();

      expect(answerSpy).toHaveBeenCalledTimes(1);
      expect(answerSpy.mock.calls[0][1]).toBe('good');
    });
  });

  // --- Esc (req 12) ----------------------------------------------------------

  describe('escape to exit', () => {
    it('navigates to / on Escape', async () => {
      const fixture = await createReview();
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigateByUrl');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      expect(navSpy).toHaveBeenCalledWith('/');
    });

    it('does not throw when an in-flight rate() resolves after navigation', async () => {
      const fixture = await createReview();
      const router = TestBed.inject(Router);
      vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      fixture.componentInstance.reveal();
      fixture.detectChanges();

      // Start a grade (in-flight) then immediately navigate away via Esc.
      const ratePromise = fixture.componentInstance.rate('good');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      await expect(ratePromise).resolves.toBeUndefined();
    });
  });

  // --- Chrome (reqs 3, 5, 10) --------------------------------------------------

  describe('chrome', () => {
    it('shows the full deck path in the breadcrumb with "·" separators', async () => {
      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const breadcrumb = el.querySelector('.breadcrumb');
      expect(breadcrumb?.textContent?.trim()).toBe('Spanish · Chapter 1');
    });

    it('shows the note-type kind uppercased in the chip', async () => {
      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const chip = el.querySelector('.chip');
      expect(chip?.textContent?.trim().toUpperCase()).toBe('CLOZE');
    });

    it('shows the three legend counts', async () => {
      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const items = Array.from(el.querySelectorAll('.legend__item')).map((li) =>
        li.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(items).toContain('New 3');
      expect(items).toContain('Learning 1');
      expect(items).toContain('Review 2');
    });

    it('shows the exact hint text', async () => {
      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const hint = el.querySelector('.helper');
      expect(hint?.textContent?.trim()).toBe(
        'space to flip · 1–4 to grade · esc to exit · − suspend',
      );
    });
  });

  // --- Listening card autoplay (req 9, 10, 13) --------------------------------

  describe('listening card autoplay', () => {
    // Mirrors server/src/store/seed.ts's real nt-spanish-2sided templates:
    // ord 0 "A → B" (text + audio) and ord 1 "Listening" (audio-only front).
    const spanishNoteType: NoteType = {
      id: 'nt-spanish-2sided',
      name: 'Spanish 2-sided',
      kind: 'standard',
      fields: [
        { name: 'SideA', ord: 0 },
        { name: 'SideB', ord: 1 },
        { name: 'SideAAudio', ord: 2 },
        { name: 'SideBAudio', ord: 3 },
      ],
      templates: [
        {
          name: 'A → B',
          ord: 0,
          qfmt: '{{SideA}}{{SideAAudio}}',
          afmt: '{{FrontSide}}\n<hr id="answer">\n{{SideB}}{{SideBAudio}}',
        },
        {
          name: 'Listening',
          ord: 1,
          qfmt: '{{SideAAudio}}{{SideBAudio}}',
          afmt: '{{SideA}}{{SideAAudio}}\n<hr id="answer">\n{{SideB}}{{SideBAudio}}',
        },
      ],
      css: '',
    };

    const spanishNote: Note = {
      id: 'n-spanish',
      noteTypeId: 'nt-spanish-2sided',
      fields: {
        SideA: 'perro',
        SideB: 'El perro corre.',
        SideAAudio: '[sound:word.mp3]',
        SideBAudio: '[sound:sentence.mp3]',
      },
      tags: [],
      created: 0,
      modified: 0,
      guid: 'g-spanish',
    };

    let playSpy: ReturnType<typeof vi.fn<() => Promise<void>>>;

    beforeEach(() => {
      playSpy = vi.fn(() => Promise.resolve());
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playSpy);
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

      storeFake.getNote = vi.fn(async (id: string) => (id === 'n-spanish' ? spanishNote : note));
      storeFake.noteTypeById = vi.fn((id: string) =>
        id === 'nt-spanish-2sided' ? spanishNoteType : noteType,
      );
    });

    it('plays the first clip automatically on a Listening (ord 1) front', async () => {
      seedQueueOneCard(card({ id: 'c-listen', noteId: 'n-spanish', ord: 1 }));

      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const audios = Array.from(el.querySelectorAll<HTMLAudioElement>('.rendered audio'));

      expect(audios.length).toBe(2);
      expect(playSpy).toHaveBeenCalledTimes(1);
    });

    it('chains to the second clip when the first fires "ended"', async () => {
      seedQueueOneCard(card({ id: 'c-listen', noteId: 'n-spanish', ord: 1 }));

      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const audios = Array.from(el.querySelectorAll<HTMLAudioElement>('.rendered audio'));
      expect(playSpy).toHaveBeenCalledTimes(1);

      audios[0].dispatchEvent(new Event('ended'));
      fixture.detectChanges();
      await flushMicrotasks();

      expect(playSpy).toHaveBeenCalledTimes(2);
    });

    it('does not autoplay for a plain A → B (ord 0) card of the same note type', async () => {
      seedQueueOneCard(card({ id: 'c-ab', noteId: 'n-spanish', ord: 0 }));

      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      // The A → B front also carries an <audio> element — proves the gate is
      // "is this the Listening template", not merely "audio is present".
      expect(el.querySelectorAll('.rendered audio').length).toBe(1);
      expect(playSpy).not.toHaveBeenCalled();
    });

    it('does not autoplay for a cloze card', async () => {
      // The default beforeEach queue serves the module-level cloze `note`/`noteType`.
      await createReview();
      expect(playSpy).not.toHaveBeenCalled();
    });

    it('has no type-in input on a Listening front (req 12)', async () => {
      seedQueueOneCard(card({ id: 'c-listen', noteId: 'n-spanish', ord: 1 }));

      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.type-input')).toBeNull();
    });
  });

  // --- Template lookup uses ord, not array index (audit B3) ------------------

  describe('template lookup uses ord, not array index', () => {
    const reorderedNoteType: NoteType = {
      id: 'nt-reordered',
      name: 'Reordered',
      kind: 'standard',
      fields: [
        { name: 'SideA', ord: 0 },
        { name: 'SideB', ord: 1 },
      ],
      templates: [
        // Deliberately out of order: array index 0 holds ord 1, index 1 holds ord 0.
        { name: 'B', ord: 1, qfmt: '{{SideB}}', afmt: '{{SideB}}' },
        { name: 'A', ord: 0, qfmt: '{{SideA}}', afmt: '{{SideA}}' },
      ],
      css: '',
    };
    const reorderedNote: Note = {
      id: 'n-reordered',
      noteTypeId: 'nt-reordered',
      fields: { SideA: 'perro', SideB: 'gato' },
      tags: [],
      created: 0,
      modified: 0,
      guid: 'g-reordered',
    };

    it('renders the template whose ord matches card.ord, not templates[card.ord]', async () => {
      storeFake.getNote = vi.fn(async (id: string) =>
        id === 'n-reordered' ? reorderedNote : note,
      );
      storeFake.noteTypeById = vi.fn((id: string) =>
        id === 'nt-reordered' ? reorderedNoteType : noteType,
      );
      seedQueueOneCard(card({ id: 'c-reordered', noteId: 'n-reordered', ord: 0 }));

      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const rendered = el.querySelector('.rendered')?.textContent ?? '';
      // ord 0 is template 'A' (renders SideA/"perro"); templates[0] is 'B' (SideB/"gato").
      expect(rendered).toContain('perro');
      expect(rendered).not.toContain('gato');
    });
  });

  // --- Type-in answer keeps keyboard shortcuts from stealing input (audit B4) -

  describe('type-in answer keyboard passthrough', () => {
    const typeInNoteType: NoteType = {
      id: 'nt-typein',
      name: 'Type-in',
      kind: 'standard',
      fields: [{ name: 'Answer', ord: 0 }],
      templates: [{ name: 'Card', ord: 0, qfmt: '{{type:Answer}}', afmt: '{{type:Answer}}' }],
      css: '',
    };
    const typeInNote: Note = {
      id: 'n-typein',
      noteTypeId: 'nt-typein',
      fields: { Answer: 'hola' },
      tags: [],
      created: 0,
      modified: 0,
      guid: 'g-typein',
    };

    beforeEach(() => {
      storeFake.getNote = vi.fn(async (id: string) => (id === 'n-typein' ? typeInNote : note));
      storeFake.noteTypeById = vi.fn((id: string) =>
        id === 'nt-typein' ? typeInNoteType : noteType,
      );
    });

    it('does not suspend the card when "-" is typed into the answer input', async () => {
      seedQueueOneCard(card({ id: 'c-typein', noteId: 'n-typein', ord: 0 }));
      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const input = el.querySelector<HTMLInputElement>('.type-input');
      expect(input).toBeTruthy();

      input!.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
      fixture.detectChanges();
      await flushMicrotasks();

      expect(storeFake.suspendCard).not.toHaveBeenCalled();
      expect(fixture.componentInstance.revealed()).toBe(false);
    });

    it('blurs the input instead of navigating away on Escape while typing an answer', async () => {
      seedQueueOneCard(card({ id: 'c-typein', noteId: 'n-typein', ord: 0 }));
      const fixture = await createReview();
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigateByUrl');
      const el = fixture.nativeElement as HTMLElement;
      const input = el.querySelector<HTMLInputElement>('.type-input')!;
      input.focus();

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      expect(navSpy).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(input);
    });

    it('still reveals on Enter while typing an answer', async () => {
      seedQueueOneCard(card({ id: 'c-typein', noteId: 'n-typein', ord: 0 }));
      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const input = el.querySelector<HTMLInputElement>('.type-input')!;

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();

      expect(fixture.componentInstance.revealed()).toBe(true);
    });
  });

  // --- Paused empty state (R17) ------------------------------------------------

  describe('paused empty state', () => {
    it('renders "All done" message when finished and not paused', async () => {
      // Unpaused finished session: collection.pausedAt is null
      queueFake.next.mockReturnValue(null);
      (storeFake.collection as any) = () => ({
        dayCutoffHour: 4,
        created: Date.now() - 30 * 86_400_000,
        pausedAt: null,
      });

      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const doneBlock = el.querySelector('.done');
      expect(doneBlock).toBeTruthy();
      expect(doneBlock?.querySelector('h2')?.textContent?.trim()).toBe('All done');
      expect(doneBlock?.querySelector('p')?.textContent?.trim()).toBe(
        'No more cards due in this deck right now.',
      );
    });

    it('renders "Scheduling is paused" message when finished and paused', async () => {
      // Paused finished session: collection.pausedAt is set
      queueFake.next.mockReturnValue(null);
      (storeFake.collection as any) = () => ({
        dayCutoffHour: 4,
        created: Date.now() - 30 * 86_400_000,
        pausedAt: Date.now(),
      });

      const fixture = await createReview();
      const el = fixture.nativeElement as HTMLElement;
      const pausedBlock = el.querySelector('.paused');
      expect(pausedBlock).toBeTruthy();
      expect(pausedBlock?.textContent?.trim()).toContain('Scheduling is paused');
    });
  });
});
