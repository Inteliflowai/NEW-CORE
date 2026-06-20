// src/lib/spark/auth.ts — constant-time bearer check for the SPARK ingestion webhook.
// No such utility existed in the repo; the only prior secret gate was a plain `!==`.
import { timingSafeEqual } from 'crypto';

/** Constant-time string compare. Length-guarded (timingSafeEqual throws on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** True iff `authHeader` is exactly `Bearer <secret>` (and secret is non-empty). */
export function bearerMatches(authHeader: string | null | undefined, secret: string): boolean {
  if (!authHeader || !secret) return false;
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return false;
  return safeEqual(authHeader.slice(prefix.length), secret);
}
