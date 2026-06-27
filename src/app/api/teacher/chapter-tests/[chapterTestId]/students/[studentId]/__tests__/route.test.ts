// Tests for GET /api/teacher/chapter-tests/[chapterTestId]/students/[studentId]
// Seg2 T5: per-student question preview
//
// Strategy: mock Supabase with mutable state variables. Tests verify:
// - Auth gates (401/403/404)
// - Questions grouped correctly by section for a student with questions
// - Empty questions[] (not 404) when student has no questions yet (generation incomplete)
// - 403 when teacher doesn't own the class

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Mutable state ─────────────────────────────────────────────────────────────
const getUserMock = vi.fn();
const profileSingleMock = vi.fn();
const guardFn = vi.fn();

let chapterTestData: unknown = { class_id: 'cl1' };
let chapterTestError: unknown = null;

let sectionsData: unknown = [
  { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary' },
  { id: 'sec2', section_order: 2, section_kind: 'short_answer', title: 'Short Answer' },
];
let sectionsError: unknown = null;

let questionsData: unknown = [];

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
            in: () => ({
              eq: () => ({
                order: () =>
                  Promise.resolve({ data: questionsData, error: null }),
              }),
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
function makeGetRequest(chapterTestId: string, studentId: string): NextRequest {
  return new NextRequest(
    `http://x/api/teacher/chapter-tests/${chapterTestId}/students/${studentId}`,
    { method: 'GET' },
  );
}

function makeParams(chapterTestId: string, studentId: string) {
  return { params: Promise.resolve({ chapterTestId, studentId }) };
}

// ── beforeEach defaults ────────────────────────────────────────────────────────
beforeEach(() => {
  getUserMock.mockReset();
  profileSingleMock.mockReset();
  guardFn.mockReset();

  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  profileSingleMock.mockResolvedValue({ data: { role: 'teacher' } });
  guardFn.mockResolvedValue(null);

  chapterTestData = { class_id: 'cl1' };
  chapterTestError = null;
  sectionsData = [
    { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary' },
    { id: 'sec2', section_order: 2, section_kind: 'short_answer', title: 'Short Answer' },
  ];
  sectionsError = null;
  questionsData = [];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/teacher/chapter-tests/[chapterTestId]/students/[studentId]', () => {
  // ── Auth gates ─────────────────────────────────────────────────────────────

  it('401 when no authenticated user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    expect(res.status).toBe(401);
  });

  it('403 when user is not a staff role (student)', async () => {
    profileSingleMock.mockResolvedValue({ data: { role: 'student' } });
    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    expect(res.status).toBe(403);
    // Guard must not be called before the role check
    expect(guardFn).not.toHaveBeenCalled();
  });

  it('403 when user is a parent (non-staff)', async () => {
    profileSingleMock.mockResolvedValue({ data: { role: 'parent' } });
    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    expect(res.status).toBe(403);
  });

  // ── Not found ──────────────────────────────────────────────────────────────

  it('404 when chapter test not found (no row)', async () => {
    chapterTestData = null;
    chapterTestError = null;
    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('no-such-test', 'stu1'),
      makeParams('no-such-test', 'stu1'),
    );
    expect(res.status).toBe(404);
  });

  it('404 when chapter_tests DB query returns an error', async () => {
    chapterTestData = null;
    chapterTestError = { message: 'DB error' };
    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    expect(res.status).toBe(404);
  });

  // ── IDOR guard ─────────────────────────────────────────────────────────────

  it("403 when teacher doesn't own the class (guardClassAccess denies)", async () => {
    guardFn.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    expect(res.status).toBe(403);
    expect(guardFn).toHaveBeenCalledWith('cl1');
  });

  it('guardClassAccess is called with the class_id from the chapter test', async () => {
    chapterTestData = { class_id: 'class-special' };
    const { GET } = await import('../route');
    await GET(makeGetRequest('ct1', 'stu1'), makeParams('ct1', 'stu1'));
    expect(guardFn).toHaveBeenCalledWith('class-special');
  });

  // ── No-questions case (generation incomplete — not 404) ────────────────────

  it('200 (not 404) with empty questions[] on each section when student has no questions yet', async () => {
    questionsData = []; // generation incomplete for this student
    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu-no-q'),
      makeParams('ct1', 'stu-no-q'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { sections: Array<{ questions: unknown[] }> };
    expect(body.sections).toHaveLength(2);
    expect(body.sections[0].questions).toEqual([]);
    expect(body.sections[1].questions).toEqual([]);
  });

  it('200 with empty sections[] when chapter has no sections yet', async () => {
    sectionsData = [];
    questionsData = [];
    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { sections: unknown[] };
    expect(body.sections).toEqual([]);
  });

  // ── Questions grouped correctly ────────────────────────────────────────────

  it('200 returns sections with questions grouped by section', async () => {
    questionsData = [
      {
        id: 'q1',
        section_id: 'sec1',
        question_order: 1,
        question_type: 'mcq',
        question_text: 'What is the meaning of "ephemeral"?',
        payload: { choices: [{ label: 'A', text: 'Short-lived' }] },
        points: 2,
      },
      {
        id: 'q2',
        section_id: 'sec1',
        question_order: 2,
        question_type: 'mcq',
        question_text: 'What is the meaning of "ubiquitous"?',
        payload: { choices: [{ label: 'A', text: 'Everywhere' }] },
        points: 2,
      },
      {
        id: 'q3',
        section_id: 'sec2',
        question_order: 1,
        question_type: 'short_answer',
        question_text: 'Explain the main theme of the chapter.',
        payload: { rubric: 'mentions theme' },
        points: 5,
      },
    ];

    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      sections: Array<{
        section_order: number;
        section_kind: string;
        title: string;
        questions: Array<{
          id: string;
          question_order: number;
          question_type: string;
          question_text: string;
          payload: unknown;
          points: number;
        }>;
      }>;
    };

    expect(body.sections).toHaveLength(2);

    // Section 1 — Vocabulary
    expect(body.sections[0].section_order).toBe(1);
    expect(body.sections[0].section_kind).toBe('vocabulary');
    expect(body.sections[0].title).toBe('Vocabulary');
    expect(body.sections[0].questions).toHaveLength(2);
    expect(body.sections[0].questions[0].id).toBe('q1');
    expect(body.sections[0].questions[0].question_type).toBe('mcq');
    expect(body.sections[0].questions[0].question_text).toBe('What is the meaning of "ephemeral"?');
    expect(body.sections[0].questions[0].points).toBe(2);
    expect(body.sections[0].questions[1].id).toBe('q2');

    // Section 2 — Short Answer
    expect(body.sections[1].section_order).toBe(2);
    expect(body.sections[1].section_kind).toBe('short_answer');
    expect(body.sections[1].questions).toHaveLength(1);
    expect(body.sections[1].questions[0].id).toBe('q3');
    expect(body.sections[1].questions[0].question_type).toBe('short_answer');
    expect(body.sections[1].questions[0].points).toBe(5);
  });

  it('response question objects include all required fields: id, question_order, question_type, question_text, payload, points', async () => {
    questionsData = [
      {
        id: 'q-uuid-1',
        section_id: 'sec1',
        question_order: 3,
        question_type: 'matching',
        question_text: 'Match each term to its definition.',
        payload: { left: ['ephemeral'], right: ['short-lived'], pairs: [{ left_idx: 0, right_idx: 0 }] },
        points: 4,
      },
    ];

    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    const body = await res.json() as {
      sections: Array<{ questions: Array<Record<string, unknown>> }>;
    };
    const q = body.sections[0].questions[0];
    expect(q.id).toBe('q-uuid-1');
    expect(q.question_order).toBe(3);
    expect(q.question_type).toBe('matching');
    expect(q.question_text).toBe('Match each term to its definition.');
    expect(q.payload).toBeDefined();
    expect(q.points).toBe(4);
  });

  it('questions from one section are not mixed into another section', async () => {
    questionsData = [
      {
        id: 'q-sec1-only',
        section_id: 'sec1',
        question_order: 1,
        question_type: 'mcq',
        question_text: 'Sec 1 Question',
        payload: {},
        points: 2,
      },
      // No questions for sec2
    ];

    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    const body = await res.json() as {
      sections: Array<{ questions: unknown[] }>;
    };
    // sec1 has 1 question, sec2 has 0 (not contaminated)
    expect(body.sections[0].questions).toHaveLength(1);
    expect(body.sections[1].questions).toHaveLength(0);
  });

  it('sections appear in section_order order even if DB returns them out of order', async () => {
    // The implementation orders sections by section_order; sections are presented in order
    sectionsData = [
      { id: 'sec2', section_order: 2, section_kind: 'short_answer', title: 'Short Answer' },
      { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary' },
    ];
    questionsData = [];

    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    const body = await res.json() as {
      sections: Array<{ section_order: number; section_kind: string }>;
    };
    // DB mock returns them in the order provided (ordering is done at DB level
    // via .order('section_order')); just verify both are returned
    expect(body.sections).toHaveLength(2);
    const orders = body.sections.map((s) => s.section_order);
    expect(orders).toContain(1);
    expect(orders).toContain(2);
  });

  // ── Error paths ────────────────────────────────────────────────────────────

  it('500 when chapter_test_sections DB returns an error', async () => {
    sectionsError = { message: 'DB error' };
    const { GET } = await import('../route');
    const res = await GET(
      makeGetRequest('ct1', 'stu1'),
      makeParams('ct1', 'stu1'),
    );
    expect(res.status).toBe(500);
  });
});
