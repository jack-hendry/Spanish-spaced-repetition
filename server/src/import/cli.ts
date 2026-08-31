// CLI: read raw scraped book JSON from data/spanish/_source and write the
// canonical collection into data/spanish. Idempotent — preserves scheduling.
//
//   npm run import            (from repo root, via workspace script)

import { dataDir, sourceDir } from '../paths.js';
import { FileStore } from '../store/file-store.js';
import { runImport } from './run.js';

async function main(): Promise<void> {
  const src = sourceDir();
  const out = dataDir();
  console.log(`[import] source: ${src}`);
  console.log(`[import] target: ${out}`);

  const store = new FileStore(out);
  await store.init();

  const result = await runImport(store, src);
  console.log(
    `[import] wrote ${result.decks.length} decks, ${result.notes.length} notes, ${result.cards.length} cards`,
  );
}

main().catch((err: unknown) => {
  console.error('[import] failed:', err);
  process.exit(1);
});
