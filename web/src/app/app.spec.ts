import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { App } from './app';
import { CollectionStore } from './core/collection.store';
import type { Card, Collection, Deck } from './core/models';
import { PauseService } from './core/pause.service';

/** Trivial stand-ins for the lazy-loaded route components (routerLinkActive
 * only needs matching paths to resolve against Router.url; the real feature
 * components aren't under test here). */
@Component({ selector: 'app-test-stub', template: '' })
class Stub {}

describe('App', () => {
  const collection: Collection = {
    schemaVersion: 1,
    created: Date.now() - 30 * 86_400_000,
    modified: Date.now(),
    dayCutoffHour: 4,
    defaultDeckOptionsId: 'opt1',
    tags: [],
    pausedAt: null,
  };

  const decks: Deck[] = [
    { id: 'd1', name: 'Spanish', parentId: null, optionsId: 'opt1', collapsed: false },
    { id: 'd2', name: 'French', parentId: null, optionsId: 'opt1', collapsed: false },
  ];

  function card(overrides: Partial<Card>): Card {
    return {
      id: 'c',
      noteId: 'n',
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
      ease: 0,
      interval: 0,
      stability: null,
      difficulty: null,
      ...overrides,
    };
  }

  /**
   * Populate CollectionStore signals directly rather than calling `store.load()`:
   * `load()` -> `unburyForNewDay()` fires an un-mocked `PATCH /api/collection`
   * that hangs the test harness (see STATE.md "Notes / Discovered", carried
   * from feature 003).
   */
  function seedStore(): CollectionStore {
    const store = TestBed.inject(CollectionStore);
    store.collection.set(collection);
    store.decks.set(decks);
    store.cards.set([card({ id: 'c1', deckId: 'd1', queue: 'new', type: 'new' })]);
    return store;
  }

  let recoverOnLoad: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    recoverOnLoad = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: '', component: Stub },
          { path: 'browse', component: Stub },
          { path: 'stats', component: Stub },
        ]),
        { provide: PauseService, useValue: { recoverOnLoad } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    seedStore();
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('omits zero-count pills and renders only nonzero pills', () => {
    seedStore();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const rows = Array.from(compiled.querySelectorAll('.row'));
    expect(rows.length).toBe(2);

    const french = rows.find((r) => r.textContent?.includes('French'));
    expect(french?.querySelectorAll('.count').length).toBe(0);

    const spanish = rows.find((r) => r.textContent?.includes('Spanish'));
    expect(spanish?.querySelectorAll('.count').length).toBe(1);
    expect(spanish?.querySelector('.count--new')?.textContent).toBe('1');
  });

  it('marks the Decks tab active on the default route', async () => {
    seedStore();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    // RouterLinkActive updates its classes inside a queued microtask.
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const decksTab = compiled.querySelector('.tab[href="/"]');
    const browseTab = compiled.querySelector('.tab[href="/browse"]');
    expect(decksTab?.classList.contains('tab--active')).toBe(true);
    expect(browseTab?.classList.contains('tab--active')).toBe(false);
  });

  it('marks the Browse tab active after navigating to /browse', async () => {
    seedStore();
    const router = TestBed.inject(Router);

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    await router.navigateByUrl('/browse');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const decksTab = compiled.querySelector('.tab[href="/"]');
    const browseTab = compiled.querySelector('.tab[href="/browse"]');
    expect(browseTab?.classList.contains('tab--active')).toBe(true);
    expect(decksTab?.classList.contains('tab--active')).toBe(false);
  });

  it('renders the paused banner when pausedAt is set', () => {
    const store = seedStore();
    store.collection.set({ ...collection, pausedAt: Date.now() });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.pause-banner')?.textContent).toContain('Scheduling paused');
  });

  it('omits the paused banner when pausedAt is null', () => {
    seedStore();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.pause-banner')).toBeNull();
  });

  it('calls PauseService.recoverOnLoad() exactly once after the collection loads', () => {
    seedStore();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(recoverOnLoad).toHaveBeenCalledTimes(1);
  });
});
