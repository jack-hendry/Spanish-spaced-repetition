import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { basicAuth, safeEqual } from './auth.js';
import type { Server } from 'http';

describe('basicAuth middleware', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(basicAuth('u', 'p'));
    app.get('/x', (req, res) => res.status(200).json({}));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        const port = addr != null && typeof addr === 'object' ? addr.port : 3000;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it('no Authorization header → 401', async () => {
    const res = await fetch(`${baseUrl}/x`);
    expect(res.status).toBe(401);
  });

  it('401 response carries WWW-Authenticate header starting with Basic', async () => {
    const res = await fetch(`${baseUrl}/x`);
    const auth = res.headers.get('www-authenticate');
    expect(auth).toBeDefined();
    expect(auth).toMatch(/^Basic/);
  });

  it('correct u:p → 200', async () => {
    const encoded = Buffer.from('u:p').toString('base64');
    const res = await fetch(`${baseUrl}/x`, {
      headers: { authorization: `Basic ${encoded}` },
    });
    expect(res.status).toBe(200);
  });

  it('wrong password → 401', async () => {
    const encoded = Buffer.from('u:wrong').toString('base64');
    const res = await fetch(`${baseUrl}/x`, {
      headers: { authorization: `Basic ${encoded}` },
    });
    expect(res.status).toBe(401);
  });

  it('wrong user → 401', async () => {
    const encoded = Buffer.from('wrong:p').toString('base64');
    const res = await fetch(`${baseUrl}/x`, {
      headers: { authorization: `Basic ${encoded}` },
    });
    expect(res.status).toBe(401);
  });

  it('both wrong → 401', async () => {
    const encoded = Buffer.from('wrong:wrong').toString('base64');
    const res = await fetch(`${baseUrl}/x`, {
      headers: { authorization: `Basic ${encoded}` },
    });
    expect(res.status).toBe(401);
  });

  it('password containing a colon → 200', async () => {
    const app2 = express();
    app2.use(basicAuth('u', 'p:x'));
    app2.get('/x', (req, res) => res.status(200).json({}));
    await new Promise<void>((resolve) => {
      // `listen`'s callback is void-returning, so the async work is an
      // explicitly-voided IIFE rather than an async listener.
      const server2 = app2.listen(0, () => {
        void (async () => {
          const addr = server2.address();
          const port2 = addr != null && typeof addr === 'object' ? addr.port : 3000;
          const encoded = Buffer.from('u:p:x').toString('base64');
          const res = await fetch(`http://localhost:${port2}/x`, {
            headers: { authorization: `Basic ${encoded}` },
          });
          expect(res.status).toBe(200);
          server2.close(() => {
            resolve();
          });
        })();
      });
    });
  });

  it('Authorization: Bearer abc → 401', async () => {
    const res = await fetch(`${baseUrl}/x`, {
      headers: { authorization: 'Bearer abc' },
    });
    expect(res.status).toBe(401);
  });

  it('safeEqual with differing lengths does not throw', () => {
    const result = safeEqual('a', 'ab');
    expect(result).toBe(false);
  });
});
