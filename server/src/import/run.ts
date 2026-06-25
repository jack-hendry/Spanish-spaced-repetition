// Shared import driver used by both the CLI and POST /api/import.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { FileStore } from '../store/file-store.js';
import {
  transformBooks,
  type ImportResult,
  type ScrapedBook,
  type SourceBook,
} from './transform.js';

export function loadSourceBooks(dir: string): SourceBook[] {
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_'),
  );
  return files.map((f) => {
    const root = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ScrapedBook;
    return { slug: basename(f, '.json'), root };
  });
}

/** Transform all source books and persist the result, preserving scheduling. */
export async function runImport(
  store: FileStore,
  sourceDir: string,
): Promise<ImportResult> {
  const books = loadSourceBooks(sourceDir);
  const result = transformBooks(books, {
    decks: store.getDecks(),
    notes: store.getNotes(),
    cards: store.getCards(),
  });
  await store.replaceAll({
    decks: result.decks,
    notes: result.notes,
    cards: result.cards,
  });
  await store.flushAll();
  return result;
}
