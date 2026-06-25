// Resolve the canonical data directory and the raw scraped-source directory.
// Both can be overridden by env vars (handy for tests).

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// src/ (dev via tsx) or dist/ (built) -> repo root is two levels up from server/.
const repoRoot = resolve(here, '..', '..');

export function dataDir(): string {
  return process.env.DATA_DIR ?? join(repoRoot, 'data', 'spanish');
}

export function sourceDir(): string {
  return process.env.SOURCE_DIR ?? join(dataDir(), '_source');
}
