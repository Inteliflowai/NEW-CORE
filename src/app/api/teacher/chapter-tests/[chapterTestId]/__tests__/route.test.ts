// Tests for GET + PATCH /api/teacher/chapter-tests/[chapterTestId]
// T3: GET — poll generation_status + section question_counts
// T4: PATCH — publish (guards: ready + draft + all-students-covered) / archive
//
// Strategy: mock Supabase with mutable state variables so each test can control
// DB responses without module resets. Mock factories close over the vars at call-time.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Mutable state ─────────────────────────────────────────────────────────────
const getUserMock = vi.fn();
const profileSingleMock = vi.fn();
const guardFn = vi.fn();
const chapterTestUpdateSpy = vi.fn();

let chapterTestData: unknown = {
  class_id: 'cl1',
  generation_status: 'ready',
  status: 'draft',
  total_minutes: 44,
  total_points: 60,
};
let chapterTestError: unknown = null;
let chapterTestUpdateError: unknown = null;

let sectionsData: unknown = [
  { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary' },
  { id: 'sec2', section_order: 2, section_kind: 'short_answer', title: 'Short Answer' },
];
let sectionsError: unknown = null;

let questionsData: unknown = [];

// Enrollments for PATCH publish guard
let enrollmentsData: unknown = [{ student_id: 'stu1' }, { student_id: 'stu2' }];

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: profileSingleMock,
        }),
      }),
    }),
  }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'chapter_tests') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: chapterTestData, error: chapterTestError }),
            }),
          }),
          update: (patch: unknown) => {
            chapterTestUpdateSpy(patch);
            return {
              eq: () =>
                Promise.resolve({ data: null, error: chapterTestUpdateError }),
            };
          },
        };
      }
      if (t === 'chapter_test_sections') {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({ data: sectionsData, error: sectionsError }),
            }),
          }),
        };
      }
      if (t === 'chapter_test_questions') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({ data: questionsData, error: null }),
          }),
        };
      }
      if (t === 'enrollments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({ data: enrollmentsData, error: null }),
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

vi.mock('@/lib/auth/guards', () => ({
  guardClassAccess: (...a: unknown[]) => guardFn(...a),
}));

vi.mock('@/lib/auth/roles', () => ({
  STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeGetRequest(chapterTestId: string): NextRequest {
  return new NextRequest(`http://x/api/teacher/chapter-tests/${chapterTestId}`, {
    method: 'GET',
  });
}

function makePatchRequest(chapterTestId: string, body: object): NextRequest {
  return new NextRequest(`http://x/api/teacher/chapter-tests/${chapterTestId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function makeParams(chapterTestId: string) {
  return { params: Promise.resolve({ chapterTestId }) };
}

// ── beforeEach defaults ────────────────────────────────────────────────────────
beforeEach(() => {
  getUserMock.mockReset();
  profileSingleMock.mockReset();
  guardFn.mockReset();
  chapterTestUpdateSpy.mockReset();

  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  profileSingleMock.mockResolvedValue({ data: { role: 'teacher' } });
  guardFn.mockResolvedValue(null);

  chapterTestData = {
    class_id: 'cl1',
    generation_status: 'ready',
    status: 'draft',
    total_minutes: 44,
    total_points: 60,
  };
  chapterTestError = null;
  chapterTestUpdateError = null;
  sectionsData = [
    { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary' },
    { id: 'sec2', section_order: 2, section_kind: 'short_answer', title: 'Short Answer' },
  ];
  sectionsError = null;
  questionsData = [];
  enrollmentsData = [{ student_id: 'stu1' }, { student_id: 'stu2' }];
});

// ══════════════════════════════════════════════════════════════════════════════
// T3 — GET /api/teacher/chapter-tests/[chapterTestId]
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/teacher/chapter-tests/[chapterTestId]', () => {
  // ── Auth gates ─────────────────────────────────────────────────────────────

  it('401 when no authenticated user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    expect(res.status).toBe(401);
  });

  it('403 when user is not a staff role (student)', async () => {
    profileSingleMock.mockResolvedValue({ data: { role: 'student' } });
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    expect(res.status).toBe(403);
    expect(guardFn).not.toHaveBeenCalled();
  });

  it('403 when user is a parent (non-staff)', async () => {
    profileSingleMock.mockResolvedValue({ data: { role: 'parent' } });
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    expect(res.status).toBe(403);
  });

  // ── Not found ──────────────────────────────────────────────────────────────

  it('404 when chapter test not found', async () => {
    chapterTestData = null;
    chapterTestError = null;
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('no-such-test'), makeParams('no-such-test'));
    expect(res.status).toBe(404);
  });

  it('404 when chapter_tests DB query returns an error', async () => {
    chapterTestData = null;
    chapterTestError = { message: 'DB error' };
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    expect(res.status).toBe(404);
  });

  // ── IDOR guard ─────────────────────────────────────────────────────────────

  it("403 when teacher doesn't own the class (guardClassAccess denies)", async () => {
    guardFn.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    expect(res.status).toBe(403);
    expect(guardFn).toHaveBeenCalledWith('cl1');
  });

  // ── Success path ───────────────────────────────────────────────────────────

  it('200 returns generation_status, status, total_minutes, total_points', async () => {
    chapterTestData = {
      class_id: 'cl1',
      generation_status: 'generating',
      status: 'draft',
      total_minutes: 44,
      total_points: 60,
    };
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      generation_status: string;
      status: string;
      total_minutes: number;
      total_points: number;
    };
    expect(body.generation_status).toBe('generating');
    expect(body.status).toBe('draft');
    expect(body.total_minutes).toBe(44);
    expect(body.total_points).toBe(60);
  });

  it('200 returns sections array with section_order, section_kind, title', async () => {
    sectionsData = [
      { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary' },
      { id: 'sec2', section_order: 2, section_kind: 'short_answer', title: 'Short Answer' },
      { id: 'sec3', section_order: 3, section_kind: 'compare_contrast', title: 'Compare & Contrast' },
    ];
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    const body = await res.json() as {
      sections: Array<{ section_order: number; section_kind: string; title: string; question_counts: Record<string, number> }>;
    };
    expect(body.sections).toHaveLength(3);
    expect(body.sections[0].section_order).toBe(1);
    expect(body.sections[0].section_kind).toBe('vocabulary');
    expect(body.sections[0].title).toBe('Vocabulary');
  });

  it('question_counts.total = 0 when no questions generated yet', async () => {
    questionsData = [];
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    const body = await res.json() as { sections: Array<{ question_counts: Record<string, number> }> };
    expect(body.sections[0].question_counts.total).toBe(0);
    expect(body.sections[1].question_counts.total).toBe(0);
  });

  it('question_counts.total = 2 when 2 distinct students have questions in a section', async () => {
    questionsData = [
      { section_id: 'sec1', student_id: 'stu1' },
      { section_id: 'sec1', student_id: 'stu1' }, // stu1 has 2 questions
      { section_id: 'sec1', student_id: 'stu2' },  // stu2 has 1 question
    ];
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    const body = await res.json() as { sections: Array<{ question_counts: Record<string, number> }> };
    expect(body.sections[0].question_counts.total).toBe(2);
  });

  it('question_counts[studentId] = correct per-student count', async () => {
    questionsData = [
      { section_id: 'sec1', student_id: 'stu1' },
      { section_id: 'sec1', student_id: 'stu1' }, // stu1 has 2 questions in sec1
      { section_id: 'sec1', student_id: 'stu2' },  // stu2 has 1 question in sec1
      { section_id: 'sec2', student_id: 'stu1' },  // stu1 has 1 question in sec2
    ];
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    const body = await res.json() as { sections: Array<{ question_counts: Record<string, number> }> };
    // Section 1
    expect(body.sections[0].question_counts.total).toBe(2);
    expect(body.sections[0].question_counts['stu1']).toBe(2);
    expect(body.sections[0].question_counts['stu2']).toBe(1);
    // Section 2 — only stu1 has questions
    expect(body.sections[1].question_counts.total).toBe(1);
    expect(body.sections[1].question_counts['stu1']).toBe(1);
    expect(body.sections[1].question_counts['stu2']).toBeUndefined();
  });

  it('200 with empty sections array when chapter has no sections yet', async () => {
    sectionsData = [];
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { sections: unknown[] };
    expect(body.sections).toEqual([]);
  });

  it('500 when chapter_test_sections DB returns an error', async () => {
    sectionsError = { message: 'DB error' };
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    expect(res.status).toBe(500);
  });

  it('guardClassAccess is called with the class_id from the chapter test', async () => {
    chapterTestData = {
      class_id: 'class-special',
      generation_status: 'ready',
      status: 'draft',
      total_minutes: 44,
      total_points: 60,
    };
    const { GET } = await import('../route');
    await GET(makeGetRequest('ct1'), makeParams('ct1'));
    expect(guardFn).toHaveBeenCalledWith('class-special');
  });

  it('question counts are isolated between sections (sec2 not contaminated by sec1 data)', async () => {
    sectionsData = [
      { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary' },
      { id: 'sec2', section_order: 2, section_kind: 'short_answer', title: 'Short Answer' },
    ];
    questionsData = [
      { section_id: 'sec1', student_id: 'stu1' },
      { section_id: 'sec1', student_id: 'stu2' },
      // sec2 intentionally empty
    ];
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest('ct1'), makeParams('ct1'));
    const body = await res.json() as { sections: Array<{ question_counts: Record<string, number> }> };
    expect(body.sections[0].question_counts.total).toBe(2); // sec1 has 2 students
    expect(body.sections[1].question_counts.total).toBe(0); // sec2 has 0
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T4 — PATCH /api/teacher/chapter-tests/[chapterTestId]
// ══════════════════════════════════════════════════════════════════════════════

describe('PATCH /api/teacher/chapter-tests/[chapterTestId]', () => {
  // ── Auth gates (shared auth prologue) ──────────────────────────────────────

  it('401 when no authenticated user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(401);
  });

  it('403 when user is not staff', async () => {
    profileSingleMock.mockResolvedValue({ data: { role: 'student' } });
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(403);
  });

  it('404 when chapter test not found', async () => {
    chapterTestData = null;
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct-none', { action: 'publish' }), makeParams('ct-none'));
    expect(res.status).toBe(404);
  });

  it('403 when guardClassAccess denies', async () => {
    guardFn.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(403);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  it('400 when action is invalid', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'delete' }), makeParams('ct1'));
    expect(res.status).toBe(400);
  });

  it('400 when action is missing', async () => {
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', {}), makeParams('ct1'));
    expect(res.status).toBe(400);
  });

  it('400 when body is not valid JSON', async () => {
    const { PATCH } = await import('../route');
    const req = new NextRequest('http://x/api/teacher/chapter-tests/ct1', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await PATCH(req, makeParams('ct1'));
    expect(res.status).toBe(400);
  });

  // ── Publish guards ─────────────────────────────────────────────────────────

  it('409 when publish but generation_status is not ready (still queued)', async () => {
    chapterTestData = {
      class_id: 'cl1',
      generation_status: 'queued',
      status: 'draft',
      total_minutes: 44,
      total_points: 60,
    };
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/generating/i);
  });

  it('409 when publish but generation_status is generating', async () => {
    chapterTestData = {
      class_id: 'cl1',
      generation_status: 'generating',
      status: 'draft',
      total_minutes: 44,
      total_points: 60,
    };
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(409);
  });

  it('409 when publish but generation_status is failed', async () => {
    chapterTestData = {
      class_id: 'cl1',
      generation_status: 'failed',
      status: 'draft',
      total_minutes: 44,
      total_points: 60,
    };
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(409);
  });

  it('409 when publish but status is already published', async () => {
    chapterTestData = {
      class_id: 'cl1',
      generation_status: 'ready',
      status: 'published',
      total_minutes: 44,
      total_points: 60,
    };
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/published/i);
  });

  it('409 when publish but status is archived', async () => {
    chapterTestData = {
      class_id: 'cl1',
      generation_status: 'ready',
      status: 'archived',
      total_minutes: 44,
      total_points: 60,
    };
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(409);
  });

  it('409 when not all students have questions in every section', async () => {
    // 2 enrolled students, only 1 has questions in sec1
    enrollmentsData = [{ student_id: 'stu1' }, { student_id: 'stu2' }];
    sectionsData = [
      { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary' },
    ];
    questionsData = [
      { section_id: 'sec1', student_id: 'stu1' }, // stu2 missing
    ];
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/questions/i);
  });

  it('409 when one section has all students but another section does not', async () => {
    enrollmentsData = [{ student_id: 'stu1' }, { student_id: 'stu2' }];
    sectionsData = [
      { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary' },
      { id: 'sec2', section_order: 2, section_kind: 'short_answer', title: 'Short Answer' },
    ];
    questionsData = [
      // sec1: both students covered
      { section_id: 'sec1', student_id: 'stu1' },
      { section_id: 'sec1', student_id: 'stu2' },
      // sec2: only stu1 (stu2 missing)
      { section_id: 'sec2', student_id: 'stu1' },
    ];
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(409);
  });

  // ── Publish success ────────────────────────────────────────────────────────

  it('200 publish — sets status=published and published_at when all guards pass', async () => {
    enrollmentsData = [{ student_id: 'stu1' }, { student_id: 'stu2' }];
    sectionsData = [
      { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary' },
    ];
    // Both students have at least one question in sec1
    questionsData = [
      { section_id: 'sec1', student_id: 'stu1' },
      { section_id: 'sec1', student_id: 'stu2' },
    ];
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(chapterTestUpdateSpy).toHaveBeenCalledOnce();
    const updatePayload = chapterTestUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.status).toBe('published');
    expect(typeof updatePayload.published_at).toBe('string');
    // published_at is an ISO date string
    expect(new Date(updatePayload.published_at as string).getFullYear()).toBeGreaterThanOrEqual(2024);
  });

  it('publish allowed when no students are enrolled (0 enrolled = trivially covered)', async () => {
    enrollmentsData = [];
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(200);
  });

  it('publish allowed when sections array is empty (trivially covered)', async () => {
    enrollmentsData = [{ student_id: 'stu1' }];
    sectionsData = [];
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(200);
  });

  // ── Archive ────────────────────────────────────────────────────────────────

  it('200 archive — sets archived_at + status=archived regardless of generation state', async () => {
    chapterTestData = {
      class_id: 'cl1',
      generation_status: 'queued', // even if still generating, can archive
      status: 'draft',
      total_minutes: 44,
      total_points: 60,
    };
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'archive' }), makeParams('ct1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(chapterTestUpdateSpy).toHaveBeenCalledOnce();
    const updatePayload = chapterTestUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.status).toBe('archived');
    expect(typeof updatePayload.archived_at).toBe('string');
  });

  it('archive can archive a published test', async () => {
    chapterTestData = {
      class_id: 'cl1',
      generation_status: 'ready',
      status: 'published',
      total_minutes: 44,
      total_points: 60,
    };
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'archive' }), makeParams('ct1'));
    expect(res.status).toBe(200);
    const updatePayload = chapterTestUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.status).toBe('archived');
    expect(updatePayload.archived_at).toBeDefined();
  });

  // ── DB error paths ─────────────────────────────────────────────────────────

  it('500 when chapter_tests update fails during publish', async () => {
    enrollmentsData = []; // skip the all-students check
    chapterTestUpdateError = { message: 'update failed' };
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'publish' }), makeParams('ct1'));
    expect(res.status).toBe(500);
  });

  it('500 when chapter_tests update fails during archive', async () => {
    chapterTestUpdateError = { message: 'update failed' };
    const { PATCH } = await import('../route');
    const res = await PATCH(makePatchRequest('ct1', { action: 'archive' }), makeParams('ct1'));
    expect(res.status).toBe(500);
  });
});
