// src/lib/rateLimit.ts
// Per-user rate limiting for the expensive / abuse-sensitive AI endpoints,
// backed by Upstash Redis so the ceiling is shared across all serverless
// instances (an in-memory counter wouldn't hold on Vercel). Ported from V1's
// lib/rateLimit.ts.
//
// GRACEFUL DEGRADATION: with no Upstash creds the limiter is null and all
// traffic is allowed — so this wiring is safe to ship BEFORE the creds land.
// Paste UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN into Vercel to turn
// enforcement on. The 'core-v2:' key prefix keeps V2's counts separate from V1.
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// AI-heavy / paid routes: 10 requests per 60 s per user (matches V1's aiRateLimit).
export const aiRateLimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '60 s'), prefix: 'core-v2:ai' })
  : null;

// The minimal shape we depend on — lets tests inject a fake without the Upstash
// client, and keeps callers decoupled from the concrete Ratelimit type.
export interface RateLimiterLike {
  limit(identifier: string): Promise<{ success: boolean; remaining: number }>;
}

/**
 * Returns the limiter verdict. With no limiter configured, allows through (no ceiling).
 * FAILS OPEN: if the limiter store (Upstash) is unreachable and `.limit()` throws, allow
 * the request rather than 500 — a limiter outage must not take down the paid endpoint for
 * every user. (Abuse during a Redis outage is the lesser risk vs. a total feature outage.)
 */
export async function checkRateLimit(
  limiter: RateLimiterLike | null,
  identifier: string,
): Promise<{ success: boolean; remaining: number }> {
  if (!limiter) return { success: true, remaining: 999 };
  try {
    const result = await limiter.limit(identifier);
    return { success: result.success, remaining: result.remaining };
  } catch (err) {
    console.error('[rateLimit] limiter store unreachable — failing open:', err);
    return { success: true, remaining: 999 };
  }
}

/** The standard 429 response (body shape matches the routes' other `{ error }` replies). */
export function tooManyRequests(): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please wait a moment and try again.' },
    { status: 429, headers: { 'Retry-After': '60' } },
  );
}

/**
 * Enforce the per-user AI ceiling. Returns a 429 NextResponse when the caller is
 * over the limit, or null to proceed. `limiter` defaults to the module aiRateLimit;
 * pass an explicit limiter in tests.
 */
export async function enforceAiRateLimit(
  identifier: string,
  limiter: RateLimiterLike | null = aiRateLimit,
): Promise<NextResponse | null> {
  const { success } = await checkRateLimit(limiter, identifier);
  return success ? null : tooManyRequests();
}
