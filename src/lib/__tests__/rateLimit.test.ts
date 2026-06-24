import { describe, it, expect } from 'vitest';
import { checkRateLimit, enforceAiRateLimit, tooManyRequests } from '../rateLimit';

// Fake limiters with the minimal RateLimiterLike shape (no Upstash client needed).
const okLimiter = { limit: async () => ({ success: true, remaining: 9 }) };
const overLimiter = { limit: async () => ({ success: false, remaining: 0 }) };

describe('checkRateLimit', () => {
  it('allows through with no limiter configured (graceful degradation = no ceiling)', async () => {
    expect(await checkRateLimit(null, 'user-1')).toEqual({ success: true, remaining: 999 });
  });

  it('passes through the limiter verdict when one is configured', async () => {
    expect(await checkRateLimit(okLimiter, 'user-1')).toEqual({ success: true, remaining: 9 });
    expect(await checkRateLimit(overLimiter, 'user-1')).toEqual({ success: false, remaining: 0 });
  });

  it('fails OPEN (allows through) when the limiter throws — e.g. Upstash unreachable', async () => {
    const throwingLimiter = { limit: async () => { throw new Error('Redis unreachable'); } };
    // A limiter outage must NOT take down the paid endpoint for everyone — allow the call.
    expect(await checkRateLimit(throwingLimiter, 'user-1')).toEqual({ success: true, remaining: 999 });
  });
});

describe('tooManyRequests', () => {
  it('is a 429 with a Retry-After header and a generic body', async () => {
    const res = tooManyRequests();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/too many/i);
  });
});

describe('enforceAiRateLimit', () => {
  it('returns null (proceed) when under the limit', async () => {
    expect(await enforceAiRateLimit('user-1', okLimiter)).toBeNull();
  });

  it('returns a 429 NextResponse when over the limit', async () => {
    const res = await enforceAiRateLimit('user-1', overLimiter);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it('proceeds (null) when no limiter is configured (creds absent)', async () => {
    expect(await enforceAiRateLimit('user-1', null)).toBeNull();
  });
});
