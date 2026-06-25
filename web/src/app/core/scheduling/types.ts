import type { Card, DeckOptions, RevlogEntry } from '../models';

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];

export const RATING_BUTTON: Record<Rating, 1 | 2 | 3 | 4> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

/** Time context for a review: wall-clock now and the current study-day number. */
export interface ReviewContext {
  now: number; // epoch ms
  today: number; // day number (see todayNumber())
}

export interface SchedulingResult {
  /** The resulting card state if this rating is chosen. */
  card: Card;
  /** Resulting interval in days (fractional for sub-day learning steps). */
  intervalDays: number;
  /** Human label shown on the rating button, e.g. "10m", "1d", "4d". */
  label: string;
}

export interface Scheduler {
  /** Preview all four outcomes without mutating the card. */
  preview(
    card: Card,
    opts: DeckOptions,
    ctx: ReviewContext,
  ): Record<Rating, SchedulingResult>;

  /** Apply a rating: returns the updated card and the revlog entry to append. */
  answer(
    card: Card,
    rating: Rating,
    opts: DeckOptions,
    ctx: ReviewContext,
    timeMs?: number,
  ): { card: Card; revlog: RevlogEntry };
}
