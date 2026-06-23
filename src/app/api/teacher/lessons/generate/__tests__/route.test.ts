// src/app/api/teacher/lessons/generate/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
const generateLesson = vi.fn();
const segmentUnit = vi.fn();
const lessonInserts: Array<Record<string, unknown>[]> = [];
let ROLE: string; let SCHOOL_STATE: string | null;
let LESSON_INSERT_ERROR: unknown; // when set, the lessons insert resolves with this .error + data:null

vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/engine/lessonGenerate', () => ({
  generateLesson, segmentUnit,
  resolveNumDays: (raw: unknown) => { const n = Number(raw); return Number.isInteger(n) && n >= 2 ? Math.min(n, 10) : 1; },
  MAX_GENERATE_DAYS: 10,
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: ROLE } }) }) }) };
      // state is now resolved via the CLASS → classes.school_id → schools.state.
      if (t === 'classes') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { school_id: 's1' } }) }) }) };
      if (t === 'schools') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { state: SCHOOL_STATE } }) }) }) };
      // lessons — insert(rows).select(...) returns the rows with synthetic ids
      return {
        insert: (rows: Record<string, unknown>[]) => {
          lessonInserts.push(rows);
          return { select: async () => (
            LESSON_INSERT_ERROR
              ? { data: null, error: LESSON_INSERT_ERROR }
              : { data: rows.map((r, i) => ({ id: `L${i + 1}`, ...r })), error: null }
          ) };
        },
      };
    },
  }),
}));

const req = (b: unknown) => new NextRequest('http://x', { method: 'POST', body: JSON.stringify(b) });
// NOTE: do NOT vi.resetModules() here — a fresh module graph would give the route a different
// LlmExhaustedError class identity than the one this test throws, breaking respondEngineError's
// instanceof check (the 503 path). This matches the lessons/parse route-test convention.
async function load() { return (await import('@/app/api/teacher/lessons/generate/route')).POST; }

const oneLesson = {
  title: 'Fractions', summary: 's', objectives: ['o'], key_concepts: ['k'],
  vocabulary: [], misconception_risks: [], grade_level: '4', subject: 'Math',
  proposed_standards: [{ code: 'CCSS.4.NF.1', description: 'd' }],
};

beforeEach(() => {
  getUser.mockReset(); guardClassAccess.mockReset(); generateLesson.mockReset(); segmentUnit.mockReset();
  lessonInserts.length = 0; ROLE = 'teacher'; SCHOOL_STATE = 'TX'; LESSON_INSERT_ERROR = null;
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  guardClassAccess.mockResolvedValue(null);
  generateLesson.mockResolvedValue(oneLesson);
});

describe('POST /api/teacher/lessons/generate', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await (await load())(req({ description: 'x', class_id: 'c1' }))).status).toBe(401);
  });
  it('403 for a non-teacher role', async () => {
    ROLE = 'student';
    expect((await (await load())(req({ description: 'x', class_id: 'c1' }))).status).toBe(403);
  });
  it('403 when guardClassAccess denies', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await (await load())(req({ description: 'x', class_id: 'c1' }))).status).toBe(403);
  });
  it('400 on a missing description', async () => {
    expect((await (await load())(req({ class_id: 'c1' }))).status).toBe(400);
  });

  it('single day → 1 lesson, source=generate, chapter_title/day_index null, framework from state', async () => {
    const res = await (await load())(req({ description: 'Teach fractions', class_id: 'c1' }));
    expect(res.status).toBe(200);
    expect(segmentUnit).not.toHaveBeenCalled();
    const rows = lessonInserts[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'generate', status: 'pending_review', class_id: 'c1', teacher_id: 'u1', chapter_title: null, day_index: null });
    expect(rows[0].standard_framework).toMatch(/TEKS/); // state TX
    const body = await res.json();
    expect(body.days).toHaveLength(1);
    expect(body.days[0].lesson_id).toBe('L1');
    expect(body.framework).toMatch(/TEKS/);
  });

  it('multi-day → segmentUnit + N lessons with chapter_title + day_index, each day generated from its own segment', async () => {
    segmentUnit.mockResolvedValue({ unit_title: 'Ecosystems', days: [
      { day: 1, title: 'A', focus: 'fa' }, { day: 2, title: 'B', focus: 'fb' },
    ] });
    const res = await (await load())(req({ description: 'Ecosystems unit', class_id: 'c1', num_days: 2 }));
    expect(res.status).toBe(200);
    expect(segmentUnit).toHaveBeenCalledOnce();
    expect(generateLesson).toHaveBeenCalledTimes(2);
    // Each day is driven by its own segment (title + focus), NOT the whole-unit description.
    expect(generateLesson).toHaveBeenNthCalledWith(1, expect.objectContaining({
      description: 'Ecosystems — Day 1: A. fa', focus: 'fa',
    }));
    expect(generateLesson).toHaveBeenNthCalledWith(2, expect.objectContaining({
      description: 'Ecosystems — Day 2: B. fb', focus: 'fb',
    }));
    const rows = lessonInserts[0];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.chapter_title === 'Ecosystems')).toBe(true);
    expect(rows.map((r) => r.day_index)).toEqual([1, 2]);
    const body = await res.json();
    expect(body.chapter_title).toBe('Ecosystems');
    expect(body.days.map((d: { day_index: number }) => d.day_index)).toEqual([1, 2]);
  });

  it('normalizes day_index to 1..N even when segmentUnit returns out-of-order/duplicated days', async () => {
    segmentUnit.mockResolvedValue({ unit_title: 'Ecosystems', days: [
      { day: 2, title: 'A', focus: 'fa' }, { day: 2, title: 'B', focus: 'fb' },
    ] });
    const res = await (await load())(req({ description: 'Ecosystems unit', class_id: 'c1', num_days: 2 }));
    expect(res.status).toBe(200);
    const rows = lessonInserts[0];
    expect(rows.map((r) => r.day_index)).toEqual([1, 2]); // position-based, NOT the model's d.day
  });

  it('500 when the lessons insert fails (fail loud, no raw DB text leaked)', async () => {
    LESSON_INSERT_ERROR = { message: 'db down' };
    const res = await (await load())(req({ description: 'x', class_id: 'c1' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/db down/); // generic message only
  });

  it('body.state overrides the school state for the framework', async () => {
    SCHOOL_STATE = 'TX';
    await (await load())(req({ description: 'x', class_id: 'c1', state: 'FL' }));
    expect(lessonInserts[0][0].standard_framework).toMatch(/B\.E\.S\.T/);
  });

  it('503 when generateLesson exhausts the LLM', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    generateLesson.mockRejectedValue(new LlmExhaustedError('openai'));
    expect((await (await load())(req({ description: 'x', class_id: 'c1' }))).status).toBe(503);
  });
});
