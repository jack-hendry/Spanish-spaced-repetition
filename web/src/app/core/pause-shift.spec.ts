import { describe, expect, it } from 'vitest';

import { computeResumeCardUpdates } from './pause-shift';
import type { Card, Collection } from './models';

const DAY = 86_400_000;

function collection(over: Partial<Collection> = {}): Collection {
  return {
    schemaVersion: 1,
    created: 0,
    modified: 0,
    dayCutoffHour: 0,
    defaultDeckOptionsId: 'o',
    tags: [],
    pausedAt: null,
    ...over,
  };
}

function card(over: Partial<Card> = {}): Card {
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
    ease: 2500,
    interval: 0,
    stability: null,
    difficulty: null,
    ...over,
  };
}

describe('computeResumeCardUpdates', () => {
  it('T1: review card due=100 (interval 5) shifts to due=130 on a day-100→130 pause', () => {
    const coll = collection({ pausedAt: 100 * DAY });
    const c = card({ id: 'r1', type: 'review', queue: 'review', due: 100, interval: 5 });
    const resumedAt = 130 * DAY;

    const updates = computeResumeCardUpdates(coll, [c], resumedAt);

    expect(updates).toEqual([{ id: 'r1', due: 130 }]);
    const shifted = updates[0].due;
    // Next FSRS review should see lastReviewDay = 125, elapsed = 130 - 125 = 5.
    expect(shifted - c.interval).toBe(125);
  });

  it('T2: learning card shifts by the exact ms delta, not treated as epoch seconds', () => {
    const pausedAt = 1_000_000_000; // arbitrary epoch-ms pause start
    const coll = collection({ pausedAt });
    const originalDue = pausedAt + 10 * 60_000; // due 10 minutes after pause
    const c = card({ id: 'l1', type: 'learning', queue: 'learning', due: originalDue });
    const resumedAt = pausedAt + 3_600_000; // resumed 1 hour (3,600,000 ms) later
    const msDelta = resumedAt - pausedAt;

    const updates = computeResumeCardUpdates(coll, [c], resumedAt);

    expect(updates).toEqual([{ id: 'l1', due: originalDue + msDelta }]);
    // Sanity: this would fail if `due` were mistakenly treated as epoch seconds
    // (i.e. the delta wrongly divided or multiplied by 1000 before being applied).
    expect(updates[0].due).not.toBe(originalDue + msDelta / 1000);
    expect(updates[0].due).not.toBe(originalDue + msDelta * 1000);
  });

  it('T3: relative spacing between two review cards is preserved after shifting', () => {
    const coll = collection({ pausedAt: 100 * DAY });
    const a = card({ id: 'a', type: 'review', queue: 'review', due: 100 });
    const b = card({ id: 'b', type: 'review', queue: 'review', due: 105 });
    const resumedAt = 130 * DAY;

    const updates = computeResumeCardUpdates(coll, [a, b], resumedAt);
    const byId = Object.fromEntries(updates.map((u) => [u.id, u.due]));

    expect(byId['a']).toBe(130);
    expect(byId['b']).toBe(135);
    expect(byId['b'] - byId['a']).toBe(b.due - a.due);
  });

  it('T4: a suspended review card shifts identically to a non-suspended review card', () => {
    const coll = collection({ pausedAt: 100 * DAY });
    const normal = card({ id: 'norm', type: 'review', queue: 'review', due: 100 });
    const suspended = card({ id: 'susp', type: 'review', queue: 'suspended', due: 100 });
    const resumedAt = 130 * DAY;

    const updates = computeResumeCardUpdates(coll, [normal, suspended], resumedAt);
    const byId = Object.fromEntries(updates.map((u) => [u.id, u.due]));

    expect(byId['susp']).toBe(byId['norm']);
    expect(byId['susp']).toBe(130);
  });

  it('T5: new-type cards never appear in the resume payload', () => {
    const coll = collection({ pausedAt: 100 * DAY });
    const n = card({ id: 'new1', type: 'new', queue: 'new', due: 3 });
    const resumedAt = 130 * DAY;

    const updates = computeResumeCardUpdates(coll, [n], resumedAt);

    expect(updates).toEqual([]);
    expect(updates.find((u) => u.id === 'new1')).toBeUndefined();
  });

  it('T6: same-day pause/resume (dayDelta and msDelta both <= 0) leaves every due unchanged', () => {
    const pausedAt = 100 * DAY + 1000;
    const coll = collection({ pausedAt });
    const resumedAt = pausedAt; // instantaneous resume: dayDelta = 0, msDelta = 0
    const review = card({ id: 'r', type: 'review', queue: 'review', due: 100 });
    const learning = card({ id: 'l', type: 'learning', queue: 'learning', due: pausedAt });
    const relearning = card({ id: 're', type: 'relearning', queue: 'learning', due: pausedAt });

    const updates = computeResumeCardUpdates(coll, [review, learning, relearning], resumedAt);

    expect(updates).toEqual([]);
  });
});
