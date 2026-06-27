// src/app/api/teacher/gradebook/chapter-attempt/__tests__/route.test.ts
// Tests for GET /api/teacher/gradebook/chapter-attempt?chapterTestId=<id>&studentId=<id>
// Auth: getUser → STAFF_ROLES → chapter_tests.class_id → guardClassAccess.
// On success: sections + per-student questions joined with responses (or null when no attempt).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mutable state (read inside the factory closures at call time) ──────────────────────────────
let ROLE = 'teacher';
let CT_ROW: unknown = { id: 'ct1', class_id: 'c1' };
let SECTIONS: unknown[] = [
  { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary', time_minutes: 8, total_points: 10 },
  { id: 'sec2', section_order: 2, section_kind: 'short_answer', title: 'Short Answer', time_minutes: 10, total_points: 15 },
];
let QUESTIONS: unknown[] = [
  { id: 'q1', section_id: 'sec1', question_order: 1, question_type: 'mcq', question_text: 'What is a simile?', points: 5 },
  { id: 'q2', section_id: 'sec2', question_order: 1, question_type: 'short_answer', question_text: 'Describe X.', points: 10 },
];
let ATTEMPT: unknown = { id: 'at1', status: 'graded', total_grade: 47, total_max: 60 };
let RESPONSES: unknown[] = [
  { question_id: 'q1', response_text: 'A comparison using like or as', response_payload: null, grade: 5, ai_feedback: 'Correct.' },
  { question_id: 'q2', response_text: 'A description...', response_payload: null, grade: 8, ai_feedback: 'Good work.' },
];

const getUser = vi.fn();
const guardClassAccess = vi.fn();

// ── Module mocks ───────────────────────────────────────────────────────────────────────────────
vi.mock('@/lib/auth/roles', () => ({
  STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const,
}));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => {
    /** A chainable builder that resolves to { data, error: null } at any terminal point. */
    function makeBuilder(data: unknown) {
      const res = { data, error: null };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        in: () => b,
        is: () => b,
        order: async () => res,
        maybeSingle: async () => res,
        // Make the builder itself thenable so `await builder.eq(...)` also resolves.
        then: (fn: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(res).then(fn, rej),
      };
      return b;
    }
    return {
      from: (t: string) => {
        if (t === 'users') return makeBuilder({ role: ROLE });
        if (t === 'chapter_tests') return makeBuilder(CT_ROW);
        if (t === 'chapter_test_sections') return makeBuilder(SECTIONS);
        if (t === 'chapter_test_questions') return makeBuilder(QUESTIONS);
        if (t === 'chapter_test_attempts') return makeBuilder(ATTEMPT);
        if (t === 'chapter_test_responses') return makeBuilder(RESPONSES);
        return makeBuilder(null);
      },
    };
  },
}));

function req(params: string) {
  return new NextRequest(`http://x/api/teacher/gradebook/chapter-attempt?${params}`);
}

beforeEach(() => {
  ROLE = 'teacher';
  CT_ROW = { id: 'ct1', class_id: 'c1' };
  SECTIONS = [
    { id: 'sec1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary', time_minutes: 8, total_points: 10 },
    { id: 'sec2', section_order: 2, section_kind: 'short_answer', title: 'Short Answer', time_minutes: 10, total_points: 15 },
  ];
  QUESTIONS = [
    { id: 'q1', section_id: 'sec1', question_order: 1, question_type: 'mcq', question_text: 'What is a simile?', points: 5 },
    { id: 'q2', section_id: 'sec2', question_order: 1, question_type: 'short_answer', question_text: 'Describe X.', points: 10 },
  ];
  ATTEMPT = { id: 'at1', status: 'graded', total_grade: 47, total_max: 60 };
  RESPONSES = [
    { question_id: 'q1', response_text: 'A comparison using like or as', response_payload: null, grade: 5, ai_feedback: 'Correct.' },
    { question_id: 'q2', response_text: 'A description...', response_payload: null, grade: 8, ai_feedback: 'Good work.' },
  ];
  getUser.mockReset();
  guardClassAccess.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  guardClassAccess.mockResolvedValue(null);
});

describe('GET /api/teacher/gradebook/chapter-attempt', () => {
  it('401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('../route');
    expect((await GET(req('chapterTestId=ct1&studentId=s1'))).status).toBe(401);
  });

  it('400 when params are missing', async () => {
    const { GET } = await import('../route');
    expect((await GET(req('chapterTestId=ct1'))).status).toBe(400);
    expect((await GET(req('studentId=s1'))).status).toBe(400);
    expect((await GET(req(''))).status).toBe(400);
  });

  it('403 when caller is not staff', async () => {
    ROLE = 'student';
    const { GET } = await import('../route');
    expect((await GET(req('chapterTestId=ct1&studentId=s1'))).status).toBe(403);
    expect(guardClassAccess).not.toHaveBeenCalled();
  });

  it('404 when chapter test does not exist', async () => {
    CT_ROW = null;
    const { GET } = await import('../route');
    expect((await GET(req('chapterTestId=ct1&studentId=s1'))).status).toBe(404);
  });

  it('403 when guardClassAccess denies (teacher does not own the class)', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const { GET } = await import('../route');
    expect((await GET(req('chapterTestId=ct1&studentId=s1'))).status).toBe(403);
  });

  it('returns sections with questions + responses for a graded attempt', async () => {
    const { GET } = await import('../route');
    const res = await GET(req('chapterTestId=ct1&studentId=s1'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Top-level attempt fields
    expect(body.attempt_id).toBe('at1');
    expect(body.status).toBe('graded');
    expect(body.total_grade).toBe(47);
    expect(body.total_max).toBe(60);

    // Sections
    expect(body.sections).toHaveLength(2);
    expect(body.sections[0].section_order).toBe(1);
    expect(body.sections[0].section_kind).toBe('vocabulary');
    expect(body.sections[0].title).toBe('Vocabulary');
    expect(body.sections[0].time_minutes).toBe(8);
    expect(body.sections[0].total_points).toBe(10);

    // Questions within section 1
    expect(body.sections[0].questions).toHaveLength(1);
    const q1 = body.sections[0].questions[0];
    expect(q1.question_order).toBe(1);
    expect(q1.question_type).toBe('mcq');
    expect(q1.question_text).toBe('What is a simile?');
    expect(q1.points).toBe(5);
    expect(q1.response_text).toBe('A comparison using like or as');
    expect(q1.grade).toBe(5);
    expect(q1.ai_feedback).toBe('Correct.');

    // guardClassAccess was called with the class_id from chapter_tests
    expect(guardClassAccess).toHaveBeenCalledWith('c1');
  });

  it('returns null attempt_id + not_started when student has no attempt', async () => {
    ATTEMPT = null;
    const { GET } = await import('../route');
    const res = await GET(req('chapterTestId=ct1&studentId=s1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempt_id).toBeNull();
    expect(body.status).toBe('not_started');
    expect(body.total_grade).toBeNull();
    expect(body.total_max).toBeNull();
    // Sections still returned; questions have null responses
    expect(body.sections).toHaveLength(2);
    expect(body.sections[0].questions[0].response_text).toBeNull();
    expect(body.sections[0].questions[0].grade).toBeNull();
  });

  it('returns in_progress status correctly', async () => {
    ATTEMPT = { id: 'at2', status: 'in_progress', total_grade: null, total_max: 60 };
    RESPONSES = [];
    const { GET } = await import('../route');
    const res = await GET(req('chapterTestId=ct1&studentId=s1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempt_id).toBe('at2');
    expect(body.status).toBe('in_progress');
    expect(body.total_grade).toBeNull();
  });

  it('returns submitted status correctly', async () => {
    ATTEMPT = { id: 'at3', status: 'submitted', total_grade: null, total_max: 60 };
    RESPONSES = [];
    const { GET } = await import('../route');
    const res = await GET(req('chapterTestId=ct1&studentId=s1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('submitted');
  });
});
