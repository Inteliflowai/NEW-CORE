// src/app/api/attempts/chapter-test/[attemptId]/__tests__/route.test.ts
// Tests for GET /api/attempts/chapter-test/[attemptId]
//
// Node environment (pure HTTP handler test).
// Auth: student-only; IDOR guard on attempt ownership.
// Covers: 401, 403 (non-student), 404 (attempt not found), 403 (wrong student),
//         403 (still in_progress), 200 (submitted, no grades yet), 200 (graded w/ sections).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Scriptable per-test state ─────────────────────────────────────────────────

const getUser = vi.fn();

let USER_ROLE: string | null = 'student';
let ATTEMPT: Record<string, unknown> | null;
let SECTIONS: Array<Record<string, unknown>>;
let QUESTIONS: Array<Record<string, unknown>>;
let RESPONSES: Array<Record<string, unknown>>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: USER_ROLE ? { role: USER_ROLE } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'chapter_test_attempts') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: ATTEMPT, error: null }),
            }),
          }),
        };
      }
      if (table === 'chapter_test_sections') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                then: (resolve: (v: unknown) => unknown) =>
                  Promise.resolve({ data: SECTIONS, error: null }).then(resolve),
              }),
            }),
          }),
        };
      }
      if (table === 'chapter_test_questions') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  then: (resolve: (v: unknown) => unknown) =>
                    Promise.resolve({ data: QUESTIONS, error: null }).then(resolve),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'chapter_test_responses') {
        return {
          select: () => ({
            eq: () => ({
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ data: RESPONSES, error: null }).then(resolve),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReq(attemptId = 'att1') {
  return new Request(`http://localhost/api/attempts/chapter-test/${attemptId}`, {
    method: 'GET',
  });
}

async function load() {
  vi.resetModules();
  return (await import('../route')).GET;
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

const FAKE_ATTEMPT_SUBMITTED = {
  id: 'att1',
  student_id: 'stu1',
  status: 'submitted',
  chapter_test_id: 'ct1',
  total_grade: null,
  total_max: 60,
  forfeit_reason: null,
  submitted_at: new Date().toISOString(),
};

const FAKE_ATTEMPT_GRADED = {
  ...FAKE_ATTEMPT_SUBMITTED,
  status: 'graded',
  total_grade: 47,
};

const FAKE_ATTEMPT_IN_PROGRESS = {
  ...FAKE_ATTEMPT_SUBMITTED,
  status: 'in_progress',
  total_grade: null,
};

const FAKE_SECTIONS: Array<Record<string, unknown>> = [
  {
    id: 'sec1',
    chapter_test_id: 'ct1',
    section_order: 1,
    title: 'Vocabulary',
    total_points: 10,
  },
  {
    id: 'sec2',
    chapter_test_id: 'ct1',
    section_order: 2,
    title: 'Short Answer',
    total_points: 15,
  },
];

const FAKE_QUESTIONS: Array<Record<string, unknown>> = [
  {
    id: 'q1',
    section_id: 'sec1',
    student_id: 'stu1',
    question_order: 1,
    question_type: 'mcq',
    question_text: 'What does X mean?',
    points: 5,
  },
  {
    id: 'q2',
    section_id: 'sec2',
    student_id: 'stu1',
    question_order: 1,
    question_type: 'short_answer',
    question_text: 'Explain Y.',
    points: 8,
  },
  {
    id: 'q3',
    section_id: 'sec2',
    student_id: 'stu1',
    question_order: 2,
    question_type: 'short_answer',
    question_text: 'Compare A and B.',
    points: 7,
  },
];

const FAKE_RESPONSES_GRADED: Array<Record<string, unknown>> = [
  {
    question_id: 'q1',
    response_text: 'Definition here',
    grade: 4,
    ai_feedback: 'Good definition.',
  },
  {
    question_id: 'q2',
    response_text: 'Because of Y.',
    grade: 6,
    ai_feedback: 'Solid answer.',
  },
  {
    question_id: 'q3',
    response_text: 'A and B differ in...',
    grade: 5,
    ai_feedback: 'Good comparison.',
  },
];

const FAKE_RESPONSES_UNGRADED: Array<Record<string, unknown>> = [
  {
    question_id: 'q1',
    response_text: 'Definition here',
    grade: null,
    ai_feedback: null,
  },
];

// ── beforeEach ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  getUser.mockReset();
  USER_ROLE = 'student';
  ATTEMPT = { ...FAKE_ATTEMPT_SUBMITTED };
  SECTIONS = [...FAKE_SECTIONS];
  QUESTIONS = [...FAKE_QUESTIONS];
  RESPONSES = [];
  getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/attempts/chapter-test/[attemptId]', () => {

  // ── 401: unauthenticated ────────────────────────────────────────────────────

  it('401 when no user is authenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/unauthorized/i);
  });

  // ── 403: non-student role ──────────────────────────────────────────────────

  it('403 when caller is a teacher', async () => {
    USER_ROLE = 'teacher';
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    expect(res.status).toBe(403);
  });

  // ── 404: attempt not found ─────────────────────────────────────────────────

  it('404 when attempt is not found', async () => {
    ATTEMPT = null;
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBeTruthy();
  });

  // ── 403: IDOR — wrong student ──────────────────────────────────────────────

  it('403 when attempt belongs to a different student', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT_SUBMITTED, student_id: 'other-student' };
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBeTruthy();
  });

  // ── 403: still in_progress ─────────────────────────────────────────────────

  it('403 when attempt is still in_progress (student should call start, not this endpoint)', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT_IN_PROGRESS };
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBeTruthy();
  });

  // ── 200: submitted (grading in progress, no grades yet) ───────────────────

  it('200 returns status=submitted with null total_grade when not yet graded', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT_SUBMITTED };
    RESPONSES = [...FAKE_RESPONSES_UNGRADED];
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('submitted');
    expect(body.total_grade).toBeNull();
    expect(body.forfeit_reason).toBeNull();
    expect(Array.isArray(body.sections)).toBe(true);
  });

  // ── 200: graded with full breakdown ───────────────────────────────────────

  it('200 returns status=graded with total_grade and section breakdown', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT_GRADED };
    RESPONSES = [...FAKE_RESPONSES_GRADED];
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('graded');
    expect(body.total_grade).toBe(47);
    expect(body.total_max).toBe(60);
    expect(body.forfeit_reason).toBeNull();
    expect(Array.isArray(body.sections)).toBe(true);
  });

  it('returns sections in section_order order', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT_GRADED };
    RESPONSES = [...FAKE_RESPONSES_GRADED];
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    const body = await res.json();
    const orders = body.sections.map((s: { section_order: number }) => s.section_order);
    expect(orders).toEqual([1, 2]);
  });

  it('computes section_grade as sum of question grades in each section', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT_GRADED };
    RESPONSES = [...FAKE_RESPONSES_GRADED];
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    const body = await res.json();
    // sec1 has q1 (grade=4)
    const sec1 = body.sections.find((s: { section_order: number }) => s.section_order === 1);
    expect(sec1.section_grade).toBe(4);
    expect(sec1.section_max).toBe(10);
    // sec2 has q2 (grade=6) + q3 (grade=5) = 11
    const sec2 = body.sections.find((s: { section_order: number }) => s.section_order === 2);
    expect(sec2.section_grade).toBe(11);
    expect(sec2.section_max).toBe(15);
  });

  it('section_grade is null when no questions in section have been graded', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT_SUBMITTED };
    RESPONSES = []; // no responses at all
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    const body = await res.json();
    for (const section of body.sections) {
      expect(section.section_grade).toBeNull();
    }
  });

  it('includes per-question data: question_text, grade, ai_feedback, response_text', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT_GRADED };
    RESPONSES = [...FAKE_RESPONSES_GRADED];
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    const body = await res.json();
    const sec1 = body.sections.find((s: { section_order: number }) => s.section_order === 1);
    const q = sec1.questions[0];
    expect(q.question_text).toBe('What does X mean?');
    expect(q.grade).toBe(4);
    expect(q.ai_feedback).toBe('Good definition.');
    expect(q.response_text).toBe('Definition here');
    expect(q.question_type).toBe('mcq');
    expect(q.points).toBe(5);
    expect(q.question_order).toBe(1);
  });

  it('forfeit_reason is returned when present', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT_GRADED, forfeit_reason: 'time_up' };
    RESPONSES = [...FAKE_RESPONSES_GRADED];
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    const body = await res.json();
    expect(body.forfeit_reason).toBe('time_up');
  });

  it('questions with no response have null grade, ai_feedback, and response_text', async () => {
    ATTEMPT = { ...FAKE_ATTEMPT_GRADED };
    // only q1 has a response
    RESPONSES = [FAKE_RESPONSES_GRADED[0]];
    const GET = await load();
    const res = await GET(makeReq(), { params: Promise.resolve({ attemptId: 'att1' }) });
    const body = await res.json();
    const sec2 = body.sections.find((s: { section_order: number }) => s.section_order === 2);
    // q2, q3 in sec2 have no response
    for (const q of sec2.questions) {
      expect(q.grade).toBeNull();
      expect(q.ai_feedback).toBeNull();
      expect(q.response_text).toBeNull();
    }
  });
});
