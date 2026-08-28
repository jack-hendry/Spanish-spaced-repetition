// Assembles the Express app. Split out of index.ts so the hardened middleware
// stack is testable without spawning a process (Analyst D4).

import { join } from 'node:path';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

import type { ServerConfig } from './config.js';
import { basicAuth } from './middleware/auth.js';
import { dataDir } from './paths.js';
import { buildRouter } from './routes/index.js';
import type { FileStore } from './store/file-store.js';

/**
 * Redirect plain HTTP to HTTPS. Fly terminates TLS at the edge and forwards
 * X-Forwarded-Proto, so `trust proxy` must be set or req.secure is never true
 * and this loops forever. Loopback is exempt: it cannot be intercepted, and
 * local verification runs over http://localhost.
 */
const forceHttps: RequestHandler = (req, res, next) => {
  if (req.secure || req.get('x-forwarded-proto') === 'https') return next();
  const host = req.get('host') ?? '';
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return next();
  res.redirect(308, `https://${host}${req.originalUrl}`);
};

export function createApp(store: FileStore, config: ServerConfig): express.Express {
  const app = express();
  app.set('trust proxy', 1);

  // ANONYMOUS BY DESIGN, and the only such route. Fly's HTTP health check
  // cannot authenticate. Never extend this to report store contents.
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  if (config.hardened) {
    app.use(forceHttps);
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            // Angular injects component styles at runtime, and note-type CSS is
            // inlined into rendered card HTML via bypassSecurityTrustHtml.
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            mediaSrc: ["'self'"],
            fontSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        },
      }),
    );
    // Bounds credential guessing without ever throttling legitimate use:
    // skipSuccessfulRequests means only failures count toward the limit.
    app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 20,
        skipSuccessfulRequests: true,
        standardHeaders: true,
        legacyHeaders: false,
      }),
    );
    // Generous ceiling. A 200-card session is ~200 review POSTs plus one
    // /media audio fetch per card, so this must not be tight.
    app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 5000,
        standardHeaders: true,
        legacyHeaders: false,
      }),
    );
    app.use(basicAuth(config.authUser, config.authPassword));
  } else {
    // Dev only: the Angular dev server on :4200 is a different origin.
    app.use(cors());
  }

  // AFTER auth, deliberately: an anonymous request never gets a body parsed.
  app.use(express.json({ limit: config.bodyLimit }));

  app.use('/media', express.static(join(dataDir(), 'media'), { dotfiles: 'deny', index: false }));
  app.use('/api', buildRouter(store, { allowImport: !config.hardened }));

  // Serve the built Angular app (web/dist/web/browser). Absent in dev, where
  // the Angular dev server on :4200 proxies /api and /media here instead.
  if (config.staticDir) {
    const staticDir = config.staticDir;
    app.use(express.static(staticDir, { index: false, dotfiles: 'deny' }));

    // SPA fallback: a hard reload on /study/:deckId must get index.html, not a
    // 404. Written as middleware because Express 5 rejects the bare '*' route
    // pattern this would otherwise use.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return next();
      res.sendFile(join(staticDir, 'index.html'));
    });
  }

  return app;
}
