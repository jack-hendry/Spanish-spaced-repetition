// Integration coverage for the hardened and dev app configurations: auth,
// CORS, media path traversal prevention, body size limits, and the health
// endpoint. Runs the real Express app over a FileStore in a temp dir.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ServerConfig } from './config.js';
import { createApp } from './app.js';
import { FileStore } from './store/file-store.js';

let dir: string;
let store: FileStore;
const originalDataDir = process.env.DATA_DIR;

async function api(base: string, path: string, init?: RequestInit): Promise<Response> {
  // `Headers` rather than an object spread: `HeadersInit` includes `string[][]`,
  // which spreads into an object as numeric indices. Caller-supplied headers
  // still win, as they did when they were spread last.
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${base}${path}`, { ...init, headers });
}

function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('hardened app', () => {
  let server: ReturnType<express.Express['listen']>;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'srs-app-hardened-'));
    process.env.DATA_DIR = dir;

    store = new FileStore(dir, { debounceMs: 0 });
    await store.init();

    // Write a real file to media dir for testing.
    mkdirSync(join(dir, 'media'), { recursive: true });
    writeFileSync(join(dir, 'media', 'x.mp3'), 'mock mp3 content');

    const config: ServerConfig = {
      hardened: true,
      allowEmptyStore: false,
      port: 0,
      authUser: 'u',
      authPassword: 'p',
      staticDir: null,
      bodyLimit: '2mb',
    };

    const app = createApp(store, config);
    server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await store.flushAll();
    await new Promise<void>((r) =>
      server.close(() => {
        r();
      }),
    );
    rmSync(dir, { recursive: true, force: true });
    process.env.DATA_DIR = originalDataDir;
  });

  it('GET /api/collection, no credentials → 401', async () => {
    const res = await api(base, '/api/collection');
    expect(res.status).toBe(401);
  });

  it('GET /api/collection with u:p → 200', async () => {
    const res = await api(base, '/api/collection', {
      headers: { authorization: basicAuth('u', 'p') },
    });
    expect(res.status).toBe(200);
  });

  it('POST /api/review, no credentials → 401', async () => {
    const res = await api(base, '/api/review', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('GET /api/health, no credentials → 200 with { ok: true }', async () => {
    const res = await api(base, '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('u:wrong → 401', async () => {
    const res = await api(base, '/api/collection', {
      headers: { authorization: basicAuth('u', 'wrong') },
    });
    expect(res.status).toBe(401);
  });

  it('wrong:p → 401', async () => {
    const res = await api(base, '/api/collection', {
      headers: { authorization: basicAuth('wrong', 'p') },
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/import with valid credentials → 404', async () => {
    const res = await api(base, '/api/import', {
      method: 'POST',
      headers: { authorization: basicAuth('u', 'p') },
    });
    expect(res.status).toBe(404);
  });

  it('GET /media/x.mp3, no credentials → 401', async () => {
    const res = await api(base, '/media/x.mp3');
    expect(res.status).toBe(401);
  });

  it('GET /media/x.mp3 with credentials → 200', async () => {
    const res = await api(base, '/media/x.mp3', {
      headers: { authorization: basicAuth('u', 'p') },
    });
    expect(res.status).toBe(200);
  });

  it('GET /media/%2e%2e%2fcards.json with credentials → not 200, and body does not contain card JSON', async () => {
    const res = await api(base, '/media/%2e%2e%2fcards.json', {
      headers: { authorization: basicAuth('u', 'p') },
    });
    expect(res.status).not.toBe(200);
    const text = await res.text();
    // Actual card JSON contains fields like "queue" with values like "new"/"review"/"learning".
    // An error page should not have this structure.
    expect(text).not.toContain('"queue"');
  });

  it('Origin: https://evil.example → response has no access-control-allow-origin header', async () => {
    const res = await api(base, '/api/collection', {
      headers: {
        authorization: basicAuth('u', 'p'),
        origin: 'https://evil.example',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('POST /api/collection/resume with 8,000 entries → not 413', async () => {
    // Build 8,000 card updates, roughly 320KB.
    const cardUpdates = Array.from({ length: 8000 }, (_, i) => ({
      id: `c${i}`,
      due: i,
    }));

    const res = await api(base, '/api/collection/resume', {
      method: 'POST',
      body: JSON.stringify({
        expectedPausedAt: 1,
        cardUpdates,
      }),
      headers: { authorization: basicAuth('u', 'p') },
    });
    expect(res.status).not.toBe(413);
  });
});

describe('dev app', () => {
  let server: ReturnType<express.Express['listen']>;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'srs-app-dev-'));
    process.env.DATA_DIR = dir;

    store = new FileStore(dir, { debounceMs: 0 });
    await store.init();

    // Write a real file to media dir for testing.
    mkdirSync(join(dir, 'media'), { recursive: true });
    writeFileSync(join(dir, 'media', 'x.mp3'), 'mock mp3 content');

    const config: ServerConfig = {
      hardened: false,
      allowEmptyStore: false,
      port: 0,
      authUser: '',
      authPassword: '',
      staticDir: null,
      bodyLimit: '2mb',
    };

    const app = createApp(store, config);
    server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await store.flushAll();
    await new Promise<void>((r) =>
      server.close(() => {
        r();
      }),
    );
    rmSync(dir, { recursive: true, force: true });
    process.env.DATA_DIR = originalDataDir;
  });

  it('GET /api/collection, no credentials → 200', async () => {
    const res = await api(base, '/api/collection');
    expect(res.status).toBe(200);
  });

  it('POST /api/import → status is not 404', async () => {
    const res = await api(base, '/api/import', { method: 'POST' });
    expect(res.status).not.toBe(404);
  });

  it('Origin: https://evil.example → response does carry access-control-allow-origin', async () => {
    const res = await api(base, '/api/collection', {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).not.toBeNull();
  });
});
