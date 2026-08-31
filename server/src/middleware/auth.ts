// HTTP Basic auth (Analyst D1). Single credential pair from the environment;
// there is no user model in the data layer and this deliberately does not add
// one.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';

/**
 * Constant-time string compare. Both sides are hashed to a fixed 32 bytes
 * first: timingSafeEqual throws on length mismatch, and the length of a
 * secret is itself information worth not leaking.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

function unauthorized(res: Response): void {
  res.set('WWW-Authenticate', 'Basic realm="Spanish SRS", charset="UTF-8"');
  res.status(401).json({ error: 'unauthorized' });
}

export function basicAuth(expectedUser: string, expectedPassword: string): RequestHandler {
  return (req: Request, res: Response, next) => {
    const [scheme, encoded] = (req.get('authorization') ?? '').split(' ');
    if (!encoded || scheme.toLowerCase() !== 'basic') {
      unauthorized(res);
      return;
    }

    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep === -1) {
      unauthorized(res);
      return;
    }

    // Both comparisons always run — no short-circuit between them.
    const userOk = safeEqual(decoded.slice(0, sep), expectedUser);
    const passOk = safeEqual(decoded.slice(sep + 1), expectedPassword);
    if (!(userOk && passOk)) {
      unauthorized(res);
      return;
    }

    next();
  };
}
