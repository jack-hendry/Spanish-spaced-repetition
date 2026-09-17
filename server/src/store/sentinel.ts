import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export class EmptyStoreError extends Error {}

const ESCAPE_HATCH = 'ALLOW_EMPTY_STORE';

/**
 * Asserts that the data store is populated with both cards and notes.
 * Throws EmptyStoreError if either file is missing, unparseable, or contains an empty array.
 * This guard prevents a failed volume mount from silently persisting blank state.
 *
 * @param dataDir - The data directory path
 * @throws EmptyStoreError if validation fails
 */
export function assertPopulatedStore(dataDir: string): void {
  const cardsPath = join(dataDir, 'cards.json');
  const notesPath = join(dataDir, 'notes.json');

  // Check cards.json
  if (!existsSync(cardsPath)) {
    throw new EmptyStoreError(
      `cards.json not found at ${cardsPath}. Set ${ESCAPE_HATCH} to bypass this check.`,
    );
  }

  let cards: unknown;
  try {
    cards = JSON.parse(readFileSync(cardsPath, 'utf8'));
  } catch {
    throw new EmptyStoreError(
      `cards.json is not valid JSON at ${cardsPath}. Set ${ESCAPE_HATCH} to bypass this check.`,
    );
  }

  if (!Array.isArray(cards) || cards.length === 0) {
    throw new EmptyStoreError(
      `cards.json is empty at ${cardsPath}. Set ${ESCAPE_HATCH} to bypass this check.`,
    );
  }

  // Check notes.json
  if (!existsSync(notesPath)) {
    throw new EmptyStoreError(
      `notes.json not found at ${notesPath}. Set ${ESCAPE_HATCH} to bypass this check.`,
    );
  }

  let notes: unknown;
  try {
    notes = JSON.parse(readFileSync(notesPath, 'utf8'));
  } catch {
    throw new EmptyStoreError(
      `notes.json is not valid JSON at ${notesPath}. Set ${ESCAPE_HATCH} to bypass this check.`,
    );
  }

  if (!Array.isArray(notes) || notes.length === 0) {
    throw new EmptyStoreError(
      `notes.json is empty at ${notesPath}. Set ${ESCAPE_HATCH} to bypass this check.`,
    );
  }
}
