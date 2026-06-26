// src/lib/parent/__tests__/getParentNarrative.test.ts
// Tests for the shared getParentNarrative cache loader.
// Node environment; mocks the engine + context loader + supabase admin client.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const loadCtx = vi.fn();
const generateNarrative = vi.fn();

vi.mock('@/lib/parent/loadParentNarrativeContext', () => ({
  loadParentNarrativeContext: (...a: unknown[]) => loadCtx(...a),
}));
vi.mock('@/lib/engine/parentNarrative', () => ({
  generateParentNarrative: (...a: unknown[]) => generateNarrative(...a),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FRESH_ROW = {
  payload: {
    paragraphs: ['Alex is doing great.', 'Keep encouraging curiosity.'],
    conversation_starters: ['What surprised you today?'],
    source: 'ai',
  },
  // generated_at = 1 hour ago → still fresh (< 24h)
  generated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
};

const STALE_ROW = {
  payload: {
    paragraphs: ['Old paragraph.'],
    conversation_starters: ['Old starter.'],
    source: 'ai',
  },
  // generated_at = 25 hours ago → stale (> 24h)
  generated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
};

const GENERATED_RESULT = {
  paragraphs: ['Fresh paragraph.', 'Another fresh one.'],
  conversation_starters: ['Fresh starter.'],
  source: 'ai' as const,
};

// ── Admin client builder ──────────────────────────────────────────────────────

/** Build a mock admin client that returns `cacheRow` for the parent_narratives read. */
function makeAdmin(cacheRow: object | null) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: cacheRow, error: null });

  const admin = {
    from: (table: string) => {
      if (table === 'parent_narratives') {
        return {
          select: () => ({ eq: () => ({ maybeSingle }) }),
          upsert,
        };
      }
      // loadParentNarrativeContext will use the admin client too — minimal stub
      return {
        select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }), limit: () => ({ }) }),
        order: () => ({ }),
      };
    },
    // expose upsert spy for assertion
    _upsert: upsert,
    _maybeSingle: maybeSingle,
  };
  return admin as unknown as import('@supabase/supabase-js').SupabaseClient & {
    _upsert: typeof upsert;
    _maybeSingle: typeof maybeSingle;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  loadCtx.mockReset();
  generateNarrative.mockReset();
  // Default: context + engine work fine
  loadCtx.mockResolvedValue({ firstName: 'Alex', gradeTrendDirection: null, hasGrowth: false, dataPoints: 0, learningStyleLabel: null, recentTopics: [] });
  generateNarrative.mockResolvedValue(GENERATED_RESULT);
});

import { getParentNarrative } from '../getParentNarrative';

describe('getParentNarrative', () => {
  it('returns the cached payload when the row is fresh (< 24h) and force is not set', async () => {
    const admin = makeAdmin(FRESH_ROW);
    const result = await getParentNarrative(admin, 'stu-1');

    expect(result.paragraphs).toEqual(FRESH_ROW.payload.paragraphs);
    expect(result.source).toBe('ai');
    expect(result.generated_at).toBe(FRESH_ROW.generated_at);

    // Engine must NOT be called on a cache hit
    expect(loadCtx).not.toHaveBeenCalled();
    expect(generateNarrative).not.toHaveBeenCalled();
    expect(admin._upsert).not.toHaveBeenCalled();
  });

  it('regenerates when the cached row is stale (> 24h)', async () => {
    const admin = makeAdmin(STALE_ROW);
    const result = await getParentNarrative(admin, 'stu-1');

    expect(result.paragraphs).toEqual(GENERATED_RESULT.paragraphs);
    expect(result.source).toBe('ai');

    expect(loadCtx).toHaveBeenCalledWith(admin, 'stu-1');
    expect(generateNarrative).toHaveBeenCalledTimes(1);
    expect(admin._upsert).toHaveBeenCalledTimes(1);
  });

  it('regenerates when no cached row exists', async () => {
    const admin = makeAdmin(null);
    const result = await getParentNarrative(admin, 'stu-2');

    expect(result.paragraphs).toEqual(GENERATED_RESULT.paragraphs);
    expect(loadCtx).toHaveBeenCalledWith(admin, 'stu-2');
    expect(generateNarrative).toHaveBeenCalledTimes(1);
    expect(admin._upsert).toHaveBeenCalledTimes(1);
  });

  it('bypasses cache and regenerates when force=true even on a fresh row', async () => {
    const admin = makeAdmin(FRESH_ROW);
    const result = await getParentNarrative(admin, 'stu-1', { force: true });

    expect(result.paragraphs).toEqual(GENERATED_RESULT.paragraphs);

    // Cache read should be skipped; engine called
    expect(admin._maybeSingle).not.toHaveBeenCalled();
    expect(generateNarrative).toHaveBeenCalledTimes(1);
    expect(admin._upsert).toHaveBeenCalledTimes(1);
  });

  it('upserts the generated result with student_id + payload + timestamps', async () => {
    const admin = makeAdmin(null);
    await getParentNarrative(admin, 'stu-3');

    const call = admin._upsert.mock.calls[0];
    const upsertedRow = call[0];
    expect(upsertedRow.student_id).toBe('stu-3');
    expect(upsertedRow.payload.paragraphs).toEqual(GENERATED_RESULT.paragraphs);
    expect(typeof upsertedRow.generated_at).toBe('string');
    expect(typeof upsertedRow.updated_at).toBe('string');
  });

  it('still returns generated result even when the cache upsert fails (never throws)', async () => {
    const admin = makeAdmin(null);
    // Make the upsert return an error
    admin._upsert.mockResolvedValue({ error: { message: 'DB down' } });

    const result = await getParentNarrative(admin, 'stu-4');

    // Still returns the generated result — DB failure must not bubble
    expect(result.paragraphs).toEqual(GENERATED_RESULT.paragraphs);
  });

  // M2: cache hit with leaked content → treat as stale and regenerate
  it('treats a fresh cached row as stale when it contains a leaked paragraph', async () => {
    const LEAKED_ROW = {
      payload: {
        paragraphs: ['there is a risk of falling behind'],
        conversation_starters: ['What surprised you today?'],
        source: 'ai',
      },
      generated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago — still fresh
    };
    const admin = makeAdmin(LEAKED_ROW);
    const result = await getParentNarrative(admin, 'stu-5');

    // Must NOT return the leaked cache row — must fall through to regenerate
    expect(result.paragraphs).toEqual(GENERATED_RESULT.paragraphs);
    expect(loadCtx).toHaveBeenCalledTimes(1);
    expect(generateNarrative).toHaveBeenCalledTimes(1);
  });

  // M5: fallback source → no upsert
  it('skips the cache upsert when the engine returns source="fallback"', async () => {
    const admin = makeAdmin(null);
    generateNarrative.mockResolvedValue({
      paragraphs: ['Just getting started.'],
      conversation_starters: ['What are you curious about?'],
      source: 'fallback',
    });

    await getParentNarrative(admin, 'stu-6');

    // Upsert must NOT be called for a transient fallback
    expect(admin._upsert).not.toHaveBeenCalled();
  });

  // ENG-2: context load error → never throws
  it('never throws when loadParentNarrativeContext rejects', async () => {
    const admin = makeAdmin(null);
    loadCtx.mockRejectedValue(new Error('DB connection lost'));

    // Must resolve (not throw) and return a result
    const result = await expect(getParentNarrative(admin, 'stu-7')).resolves.toBeDefined();
    void result; // suppress unused-variable lint
    expect(generateNarrative).toHaveBeenCalledTimes(1);
  });

  // ENG-2: cache read DB error → treated as cache-miss, falls through to generate
  it('still generates when the cache DB read throws', async () => {
    // Simulate a thrown DB error on the maybeSingle call
    const maybeSingle = vi.fn().mockRejectedValue(new Error('Supabase unreachable'));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const admin = {
      from: (table: string) => {
        if (table === 'parent_narratives') {
          return { select: () => ({ eq: () => ({ maybeSingle }) }), upsert };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }), limit: () => ({}) }), order: () => ({}) };
      },
      _upsert: upsert,
      _maybeSingle: maybeSingle,
    } as unknown as import('@supabase/supabase-js').SupabaseClient & {
      _upsert: typeof upsert;
      _maybeSingle: typeof maybeSingle;
    };

    const result = await getParentNarrative(admin, 'stu-8');

    // Must resolve and return generated content
    expect(result.paragraphs).toEqual(GENERATED_RESULT.paragraphs);
    expect(generateNarrative).toHaveBeenCalledTimes(1);
  });
});
