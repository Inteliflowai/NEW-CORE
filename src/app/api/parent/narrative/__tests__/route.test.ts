// src/app/api/parent/narrative/__tests__/route.test.ts
// Tests for GET /api/parent/narrative (guarded + 24h cache + rate-limited generation).
// Node environment.
//
// Cache-hits are returned WITHOUT enforcing rate limits.
// Generation (cache-miss) and force=1 ARE rate-limited.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// ── Mock stubs ────────────────────────────────────────────────────────────────

const getUser = vi.fn();
const guardStudentAccess = vi.fn();
const enforceAiRateLimit = vi.fn();
const getParentNarrative = vi.fn();

// Scriptable admin .from() state
let CACHE_ROW: unknown = null;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'parent_narratives') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: CACHE_ROW, error: null }),
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

vi.mock('@/lib/auth/guards', () => ({
  guardStudentAccess: (...a: unknown[]) => guardStudentAccess(...a),
}));

vi.mock('@/lib/rateLimit', () => ({
  enforceAiRateLimit: (...a: unknown[]) => enforceAiRateLimit(...a),
}));

vi.mock('@/lib/parent/getParentNarrative', () => ({
  getParentNarrative: (...a: unknown[]) => getParentNarrative(...a),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FRESH_CACHE_ROW = {
  payload: {
    paragraphs: ['Alex is doing really well.', 'Keep supporting curiosity at home.'],
    conversation_starters: ['What was the most interesting thing today?'],
    source: 'ai',
  },
  // 1 hour ago — within 24h TTL
  generated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
};

const STALE_CACHE_ROW = {
  payload: {
    paragraphs: ['Old paragraph.'],
    conversation_starters: ['Old starter.'],
    source: 'ai',
  },
  // 25 hours ago — outside 24h TTL
  generated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
};

const GENERATED_RESULT = {
  paragraphs: ['Fresh narrative paragraph.'],
  conversation_starters: ['What did you enjoy learning today?'],
  source: 'ai',
  generated_at: new Date().toISOString(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function req(params: Record<string, string> = {}) {
  const url = new URL('http://x/api/parent/narrative');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  getUser.mockReset();
  guardStudentAccess.mockReset();
  enforceAiRateLimit.mockReset();
  getParentNarrative.mockReset();
  CACHE_ROW = null;

  // Happy defaults
  getUser.mockResolvedValue({ data: { user: { id: 'parent-1' } }, error: null });
  guardStudentAccess.mockResolvedValue(null);          // allow
  enforceAiRateLimit.mockResolvedValue(null);           // under limit
  getParentNarrative.mockResolvedValue(GENERATED_RESULT);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/parent/narrative', () => {
  it('returns 401 when no user is authenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('../route');
    const res = await GET(req({ studentId: 'stu-1' }));
    expect(res.status).toBe(401);
    expect(guardStudentAccess).not.toHaveBeenCalled();
  });

  it('returns 400 when studentId is missing', async () => {
    const { GET } = await import('../route');
    const res = await GET(req({}));
    expect(res.status).toBe(400);
    expect(guardStudentAccess).not.toHaveBeenCalled();
  });

  it('returns the guard response on IDOR denial (403)', async () => {
    guardStudentAccess.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const { GET } = await import('../route');
    const res = await GET(req({ studentId: 'stu-other' }));
    expect(res.status).toBe(403);
    expect(enforceAiRateLimit).not.toHaveBeenCalled();
    expect(getParentNarrative).not.toHaveBeenCalled();
  });

  it('returns the cached narrative without rate-limiting on a fresh cache hit', async () => {
    CACHE_ROW = FRESH_CACHE_ROW;
    const { GET } = await import('../route');
    const res = await GET(req({ studentId: 'stu-1' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.paragraphs).toEqual(FRESH_CACHE_ROW.payload.paragraphs);
    expect(body.source).toBe('ai');
    expect(body.generated_at).toBe(FRESH_CACHE_ROW.generated_at);

    // CRITICAL: rate limit must NOT be enforced on cache hits
    expect(enforceAiRateLimit).not.toHaveBeenCalled();
    // The shared loader should also NOT be called (we returned early)
    expect(getParentNarrative).not.toHaveBeenCalled();
  });

  it('calls getParentNarrative and returns fresh data on a cache miss (stale)', async () => {
    CACHE_ROW = STALE_CACHE_ROW;
    const { GET } = await import('../route');
    const res = await GET(req({ studentId: 'stu-1' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.paragraphs).toEqual(GENERATED_RESULT.paragraphs);

    // Generation path is rate-limited
    expect(enforceAiRateLimit).toHaveBeenCalledWith('parent-1');
    expect(getParentNarrative).toHaveBeenCalledTimes(1);
  });

  it('calls getParentNarrative and is rate-limited on a cold cache (no row)', async () => {
    CACHE_ROW = null;
    const { GET } = await import('../route');
    const res = await GET(req({ studentId: 'stu-1' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.paragraphs).toEqual(GENERATED_RESULT.paragraphs);

    expect(enforceAiRateLimit).toHaveBeenCalledWith('parent-1');
    expect(getParentNarrative).toHaveBeenCalledWith(
      expect.anything(),
      'stu-1',
      { force: false },
    );
  });

  it('returns 429 when over the rate limit on a generation path', async () => {
    CACHE_ROW = null; // no cache → triggers generation
    enforceAiRateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 }),
    );
    const { GET } = await import('../route');
    const res = await GET(req({ studentId: 'stu-1' }));
    expect(res.status).toBe(429);
    // Engine must NOT be called when rate-limited
    expect(getParentNarrative).not.toHaveBeenCalled();
  });

  it('force=1 bypasses the cache, IS rate-limited, and calls getParentNarrative with force', async () => {
    CACHE_ROW = FRESH_CACHE_ROW; // cache is fresh but force bypasses it
    const { GET } = await import('../route');
    const res = await GET(req({ studentId: 'stu-1', force: '1' }));
    expect(res.status).toBe(200);

    // Rate limit enforced even though cache is fresh — force triggers generation
    expect(enforceAiRateLimit).toHaveBeenCalledWith('parent-1');
    expect(getParentNarrative).toHaveBeenCalledWith(
      expect.anything(),
      'stu-1',
      { force: true },
    );
  });

  it('force=1 returns 429 when over the rate limit (engine NOT called)', async () => {
    CACHE_ROW = FRESH_CACHE_ROW;
    enforceAiRateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 }),
    );
    const { GET } = await import('../route');
    const res = await GET(req({ studentId: 'stu-1', force: '1' }));
    expect(res.status).toBe(429);
    expect(getParentNarrative).not.toHaveBeenCalled();
  });

  it('returns 200 even when getParentNarrative returns a fallback result (engine never throws)', async () => {
    CACHE_ROW = null;
    getParentNarrative.mockResolvedValue({
      paragraphs: ['Your child is making progress.'],
      conversation_starters: ['What did you enjoy today?'],
      source: 'fallback',
      generated_at: new Date().toISOString(),
    });
    const { GET } = await import('../route');
    const res = await GET(req({ studentId: 'stu-1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('fallback');
  });
});
