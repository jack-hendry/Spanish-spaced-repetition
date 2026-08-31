import { dataDir } from './paths.js';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { FileStore } from './store/file-store.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[server] refusing to start: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const store = new FileStore(dataDir());
  await store.init();

  const app = createApp(store, config);

  const server = app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
    console.log(`[server] data dir: ${dataDir()}`);
    console.log(`[server] hardened: ${config.hardened}`);
    console.log(`[server] serving app: ${config.staticDir ?? '(not built)'}`);
  });

  // Flush debounced writes on shutdown so no review is lost. The listener must
  // be void-returning (`process.on` does not await it), so the async work is an
  // explicitly-voided IIFE rather than an async listener.
  const shutdown = () => {
    void (async () => {
      await store.flushAll();
      server.close(() => process.exit(0));
    })();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
