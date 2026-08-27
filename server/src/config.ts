// Server configuration, resolved from the environment exactly once at boot.
//
// FAIL SAFE (Analyst D2): hardening is the DEFAULT. `DEV_MODE=1` is the only
// way to turn it off, so a forgotten environment variable in production yields
// the SECURE behaviour, never the open one.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

export interface ServerConfig {
  /** False only when DEV_MODE=1. Governs auth, HTTPS, CORS and /api/import. */
  hardened: boolean;
  port: number;
  authUser: string;
  authPassword: string;
  /** Built Angular app to serve, or null if it hasn't been built. */
  staticDir: string | null;
  /** Max JSON body. Sized for the ~311KB /collection/resume payload. */
  bodyLimit: string;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const hardened = env.DEV_MODE !== '1';
  const authUser = env.AUTH_USER ?? '';
  const authPassword = env.AUTH_PASSWORD ?? '';

  // Analyst D3: a hardened server with no credentials must not boot. Serving
  // unauthenticated, or inventing a random password nobody knows, are both
  // worse than a failed boot.
  if (hardened && (!authUser || !authPassword)) {
    throw new ConfigError(
      'AUTH_USER and AUTH_PASSWORD must both be set when hardened. ' +
        'Set them, or pass DEV_MODE=1 for local development.',
    );
  }

  const built = join(repoRoot, 'web', 'dist', 'web', 'browser');

  return {
    hardened,
    port: Number(env.PORT ?? 3000),
    authUser,
    authPassword,
    staticDir: existsSync(built) ? built : null,
    bodyLimit: env.BODY_LIMIT ?? '2mb',
  };
}
