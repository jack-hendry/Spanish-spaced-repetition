import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DeckList } from './deck-list';
import { ApiService } from '../../core/api.service';
import { CollectionStore } from '../../core/collection.store';
import { PauseService } from '../../core/pause.service';
import type { Collection, Deck } from '../../core/models';

function collection(over: Partial<Collection> = {}): Collection {
  return {
    schemaVersion: 1,
    created: Date.now() - 30 * 86_400_000,
    modified: Date.now(),
    dayCutoffHour: 4,
    defaultDeckOptionsId: 'opt1',
    tags: [],
    pausedAt: null,
    ...over,
  };
}

const decks: Deck[] = [
  { id: 'd1', name: 'Spanish', parentId: null, optionsId: 'opt1', collapsed: false },
];

function setup(pausedAt: number | null): {
  fixture: ReturnType<typeof TestBed.createComponent<DeckList>>;
  pauseService: { pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };
} {
  const api = {
    getRevlog: vi.fn(() => of([])),
  } as unknown as ApiService;

  const pauseService = {
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  };

  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: PauseService, useValue: pauseService },
    ],
  });

  const store = TestBed.inject(CollectionStore);
  store.collection.set(collection({ pausedAt }));
  store.decks.set(decks);
  store.cards.set([]);

  const fixture = TestBed.createComponent(DeckList);
  fixture.detectChanges();

  return { fixture, pauseService };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DeckList pause toggle', () => {
  it('shows "Pause scheduling" and calls pause() when not paused', async () => {
    const { fixture, pauseService } = setup(null);
    await flush();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector<HTMLButtonElement>('.pause-toggle')!;
    expect(btn.textContent.trim()).toBe('Pause scheduling');

    btn.click();
    fixture.detectChanges();
    await flush();

    expect(pauseService.pause).toHaveBeenCalledTimes(1);
    expect(pauseService.resume).not.toHaveBeenCalled();
  });

  it('shows "Resume scheduling" and calls resume() when paused', async () => {
    const { fixture, pauseService } = setup(12_345);
    await flush();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector<HTMLButtonElement>('.pause-toggle')!;
    expect(btn.textContent.trim()).toBe('Resume scheduling');

    btn.click();
    fixture.detectChanges();
    await flush();

    expect(pauseService.resume).toHaveBeenCalledTimes(1);
    expect(pauseService.pause).not.toHaveBeenCalled();
  });

  it('disables the button while resume() is in flight and re-enables after', async () => {
    const { fixture, pauseService } = setup(12_345);
    await flush();
    fixture.detectChanges();

    let resolveResume!: () => void;
    pauseService.resume = vi.fn(async () => {
      return new Promise<void>((resolve) => {
        resolveResume = resolve;
      });
    });

    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector<HTMLButtonElement>('.pause-toggle')!;
    const clickPromise = fixture.componentInstance.togglePause();
    fixture.detectChanges();

    expect(btn.disabled).toBe(true);

    resolveResume();
    await clickPromise;
    fixture.detectChanges();

    expect(btn.disabled).toBe(false);
  });
});
