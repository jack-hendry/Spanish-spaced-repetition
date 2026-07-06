import { join } from 'node:path';

import cors from 'cors';
import express from 'express';

import { dataDir } from './paths.js';
import { buildRouter } from './routes/index.js';
import { FileStore } from './store/file-store.js';

const PORT = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  const store = new FileStore(dataDir());
  await store.init();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  // Locally imported deck audio (e.g. Anki .apkg media) lives here.
  app.use('/media', express.static(join(dataDir(), 'media')));
  app.use('/api', buildRouter(store));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  const server = app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] data dir: ${dataDir()}`);
  });

  // Flush debounced writes on shutdown so no review is lost.
  const shutdown = async () => {
    await store.flushAll();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
