// src/app/api/attempts/chapter-test/start/__tests__/route.test.ts
// Tests for POST /api/attempts/chapter-test/start
//
// Node environment (pure HTTP handler test).
// Auth: student-only (role='student'); non-student → 403.
// Covers: 401, 403 (non-student), 404 (not found / not published), 403 (not enrolled),
//         409 (generation not ready), 404 (no questions for student), 200 (create),
//         200 (resume with existing_responses), 200 (auto-forfeit after 44 min).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────────

const getUser = vi.fn();

// ── Mock after() from next/server (capture callbacks) ─────────────────────────
// The forfeit-via-start path (I1) fires grading through after(); preserve the
// real NextResponse via importOriginal so the route's responses still work.
const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>();
  return {
    ...mod,
    after: (fn: () => Promise<void>) => {
      afterCallbacks.push(fn);
    },
  };
});

// ── Mock gradeChapterAttempt (I1) ─────────────────────────────────────────────
const gradeChapterAttemptMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/chapters/gradeChapterTest', () => ({
  gradeChapterAttempt: (...args: unknown[]) => gradeChapterAttemptMock(...args),
}));

// Scriptable per-test state ─────────────────────────────────────────
let USER_ROLE: string | null = 'student';
let CHAPTER_TEST: Record<string, unknown> | null;
let ENROLLMENT: Record<string, unknown> | null;
let SECTIONS: Array<Record<string, unknown>>;
let QUESTIONS: Array<Record<string, unknown>>;
let EXISTING_ATTEMPT: Record<string, unknown> | null;
let RESPONSES: Array<Record<string, unknown>>;

// Capture writes for assertion
const attemptInserts: Array<Record<string, unknown>> = [];
const attemptUpdates: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        // role check
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: USER_ROLE ? { role: USER_ROLE } : null, error: null }),
            }),
          }),
        };
      }
      if (table === 'chapter_tests') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: CHAPTER_TEST, error: null }),
            }),
          }),
        };
      }
      if (table === 'enrollments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: ENROLLMENT, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'chapter_test_sections') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                // Awaitable directly
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
      if (table === 'chapter_test_attempts') {
        // Track calls by callCount per test
        let callCount = 0;
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: EXISTING_ATTEMPT, error: null }),
              }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => {
            attemptInserts.push(payload);
            callCount++;
            // Return the inserted attempt
            const inserted = {
              id: 'new-attempt-id',
              chapter_test_id: payload.chapter_test_id ?? 'ct1',
              student_id: payload.student_id ?? 'stu1',
              status: payload.status ?? 'in_progress',
              started_at: payload.started_at ?? new Date().toISOString(),
              last_active_at: payload.last_active_at ?? new Date().toISOString(),
            };
            return {
              select: () => ({
                single: async () => ({ data: inserted, error: null }),
              }),
            };
          },
          update: (payload: Record<string, unknown>) => {
            attemptUpdates.push(payload);
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: { ...EXISTING_ATTEMPT, ...payload },
                      error: null,
                    }),
                  }),
                  // Plain await version (no select)
                  then: (resolve: (v: unknown) => unknown) =>
                    Promise.resolve({ data: { ...EXISTING_ATTEMPT, ...payload }, error: null }).then(resolve),
                }),
              }),
            };
          },
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

// ── Request helper ─────────────────────────────────────────────────────────

function makeReq(body: unknown = { chapterTestId: 'ct1' }) {
  return new Request('http://localhost/api/attempts/chapter-test/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Lazy load so mocks are registered first
async function load() {
  vi.resetModules();
  return (await import('../route')).POST;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();
const PAST_44_MIN = new Date(Date.now() - 45 * 60 * 1000).toISOString();

const FAKE_CHAPTER_TEST = {
  id: 'ct1',
  class_id: 'cls1',
  status: 'published',
  generation_status: 'ready',
  total_minutes: 44,
  total_points: 60,
};

const FAKE_ENROLLMENT = { id: 'enroll1', student_id: 'stu1', class_id: 'cls1', is_active: true };

const FAKE_SECTIONS: Array<Record<string, unknown>> = [
  { id: 'sec1', chapter_test_id: 'ct1', section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary', time_minutes: 8, total_points: 10, power_skill: 'foundational' },
  { id: 'sec2', chapter_test_id: 'ct1', section_order: 2, section_kind: 'short_answer', title: 'Short Answer', time_minutes: 8, total_points: 10, power_skill: 'think' },
];

const FAKE_QUESTIONS: Array<Record<string, unknown>> = [
  { id: 'q1', section_id: 'sec1', student_id: 'stu1', question_order: 1, question_type: 'mcq', question_text: 'What does X mean?', payload: { choices: [{ label: 'A', text: 'Option A' }] }, points: 2 },
  { id: 'q2', section_id: 'sec2', student_id: 'stu1', question_order: 1, question_type: 'short_answer', question_text: 'Explain Y.', payload: { rubric: 'Must mention Z' }, points: 5 },
];

const FAKE_EXISTING_ATTEMPT = {
  id: 'att1',
  chapter_test_id: 'ct1',
  student_id: 'stu1',
  status: 'in_progress',
  started_at: NOW,
  last_active_at: NOW,
};

const FAKE_RESPONSES: Array<Record<string, unknown>> = [
  { id: 'r1', attempt_id: 'att1', question_id: 'q1', response_text: 'Definition here', response_payload: {} },
];

// ── beforeEach ─────────────────────────────────────────────────────────────

beforeEach(() => {
  getUser.mockReset();
  attemptInserts.length = 0;
  attemptUpdates.length = 0;
  afterCallbacks.length = 0;
  gradeChapterAttemptMock.mockReset().mockResolvedValue(undefined);

  USER_ROLE = 'student';
  CHAPTER_TEST = { ...FAKE_CHAPTER_TEST };
  ENROLLMENT = { ...FAKE_ENROLLMENT };
  SECTIONS = [...FAKE_SECTIONS];
  QUESTIONS = [...FAKE_QUESTIONS];
  EXISTING_ATTEMPT = null;
  RESPONSES = [];

  getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/attempts/chapter-test/start', () => {

  // ── 401: unauthenticated ─────────────────────────────────────────────────

  it('401 when no user is authenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/unauthorized/i);
  });

  // ── 403: non-student role ────────────────────────────────────────────────

  it('403 when caller is a teacher (non-student role)', async () => {
    USER_ROLE = 'teacher';
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBeTruthy();
  });

  it('403 when caller has school_admin role', async () => {
    USER_ROLE = 'school_admin';
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
  });

  // ── 400: missing body ────────────────────────────────────────────────────

  it('400 when chapterTestId is missing', async () => {
    const POST = await load();
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  // ── 404: chapter test not found ──────────────────────────────────────────

  it('404 when chapter test does not exist', async () => {
    CHAPTER_TEST = null;
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBeTruthy();
  });

  // ── 404: chapter test not published ─────────────────────────────────────

  it('404 when chapter test exists but status is not published', async () => {
    CHAPTER_TEST = { ...FAKE_CHAPTER_TEST, status: 'draft' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
  });

  // ── 403: student not enrolled ────────────────────────────────────────────

  it('403 when student is not enrolled in the chapter test class', async () => {
    ENROLLMENT = null;
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/enrolled/i);
  });

  // ── 409: generation not ready ────────────────────────────────────────────

  it('409 when generation_status is not ready (queued)', async () => {
    CHAPTER_TEST = { ...FAKE_CHAPTER_TEST, generation_status: 'queued' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBeTruthy();
  });

  it('409 when generation_status is generating', async () => {
    CHAPTER_TEST = { ...FAKE_CHAPTER_TEST, generation_status: 'generating' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(409);
  });

  // ── 404: no questions for this student ───────────────────────────────────

  it('404 when no questions exist for this student (generation incomplete)', async () => {
    QUESTIONS = [];
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/question/i);
  });

  // ── 200: new attempt created, returns sections + questions + empty responses

  it('200 creates a new attempt and returns sections with questions when no prior attempt', async () => {
    EXISTING_ATTEMPT = null;
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    // attempt_id present
    expect(body.attempt_id).toBeTruthy();
    // status is in_progress (new attempt)
    expect(body.status).toBe('in_progress');
    // started_at is a string
    expect(typeof body.started_at).toBe('string');
    // elapsed_seconds is a number >= 0
    expect(typeof body.elapsed_seconds).toBe('number');
    expect(body.elapsed_seconds).toBeGreaterThanOrEqual(0);
    // sections returned with questions nested
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections).toHaveLength(2);
    // Each section has an id, section_order, questions array
    const sec1 = body.sections.find((s: { section_order: number }) => s.section_order === 1);
    expect(sec1).toBeDefined();
    expect(sec1.id).toBe('sec1');
    expect(sec1.section_kind).toBe('vocabulary');
    expect(Array.isArray(sec1.questions)).toBe(true);
    expect(sec1.questions).toHaveLength(1);
    expect(sec1.questions[0].id).toBe('q1');
    expect(sec1.questions[0].question_type).toBe('mcq');
    // existing_responses is empty for a new attempt
    expect(Array.isArray(body.existing_responses)).toBe(true);
    expect(body.existing_responses).toHaveLength(0);
    // A new attempt row was inserted
    expect(attemptInserts).toHaveLength(1);
    expect(attemptInserts[0]).toMatchObject({
      chapter_test_id: 'ct1',
      student_id: 'stu1',
      status: 'in_progress',
    });
  });

  // ── 200: resume existing in_progress attempt, returns existing_responses

  it('200 resumes an existing in_progress attempt and returns existing_responses', async () => {
    EXISTING_ATTEMPT = { ...FAKE_EXISTING_ATTEMPT };
    RESPONSES = [...FAKE_RESPONSES];
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.attempt_id).toBe('att1');
    expect(body.status).toBe('in_progress');
    // Sections and questions still returned
    expect(body.sections).toHaveLength(2);
    // existing_responses contains the saved response
    expect(Array.isArray(body.existing_responses)).toBe(true);
    expect(body.existing_responses).toHaveLength(1);
    expect(body.existing_responses[0].question_id).toBe('q1');
    expect(body.existing_responses[0].response_text).toBe('Definition here');
    // No new insert (resumed)
    expect(attemptInserts).toHaveLength(0);
  });

  // ── 200: auto-forfeit when elapsed >= 44 minutes ─────────────────────────

  it('200 auto-forfeits and returns { forfeited: true, attempt_id } when elapsed >= 44 min', async () => {
    EXISTING_ATTEMPT = {
      ...FAKE_EXISTING_ATTEMPT,
      started_at: PAST_44_MIN,
      status: 'in_progress',
    };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.forfeited).toBe(true);
    expect(body.attempt_id).toBe('att1');
    // The attempt should have been updated to submitted with forfeit_reason='time_up'
    expect(attemptUpdates).toHaveLength(1);
    expect(attemptUpdates[0]).toMatchObject({
      status: 'submitted',
      forfeit_reason: 'time_up',
    });
    expect(typeof attemptUpdates[0].submitted_at).toBe('string');
  });

  // ── 200: already submitted attempt is NOT forfeited again ───────────────

  it('200 returns the attempt data normally if attempt is submitted (not re-forfeited)', async () => {
    EXISTING_ATTEMPT = {
      ...FAKE_EXISTING_ATTEMPT,
      started_at: PAST_44_MIN,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    };
    RESPONSES = [...FAKE_RESPONSES];
    const POST = await load();
    const res = await POST(makeReq());
    // Should still return 200 (or could be a different path — the route should not crash)
    // The submitted attempt is returned without re-forfeiting
    expect(res.status).toBe(200);
    const body = await res.json();
    // No auto-forfeit update should happen (attempt already submitted)
    expect(attemptUpdates).toHaveLength(0);
    expect(body.attempt_id).toBe('att1');
  });

  // ── questions grouped per section correctly ───────────────────────────────

  it('nests questions in the correct section by section_id', async () => {
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    const sec2 = body.sections.find((s: { section_order: number }) => s.section_order === 2);
    expect(sec2).toBeDefined();
    expect(sec2.questions).toHaveLength(1);
    expect(sec2.questions[0].id).toBe('q2');
    expect(sec2.questions[0].question_type).toBe('short_answer');
    // C1: the rubric is grading material and is stripped from the student-facing payload.
    expect(sec2.questions[0].payload).toEqual({});
  });

  // ── C1: student-facing payload is sanitized (no answer key) ──────────────────

  it('C1: MCQ payload sent to the student excludes correct_answer and rationale', async () => {
    SECTIONS = [
      { id: 'sec1', chapter_test_id: 'ct1', section_order: 1, section_kind: 'mcq', title: 'MCQ', time_minutes: 8, total_points: 10, power_skill: null },
    ];
    QUESTIONS = [
      {
        id: 'qm', section_id: 'sec1', student_id: 'stu1', question_order: 1, question_type: 'mcq',
        question_text: 'Pick one', points: 2,
        payload: {
          choices: [{ label: 'A', text: 'Opt A' }, { label: 'B', text: 'Opt B' }],
          correct_answer: 'B',
          rationale: 'B is right because…',
        },
      },
    ];
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    const q = body.sections
      .flatMap((s: { questions: Array<{ id: string }> }) => s.questions)
      .find((qq: { id: string }) => qq.id === 'qm');
    expect(q).toBeTruthy();
    expect(q.payload).not.toHaveProperty('correct_answer');
    expect(q.payload).not.toHaveProperty('rationale');
    // Display-safe choices are retained.
    expect(Array.isArray(q.payload.choices)).toBe(true);
    expect(q.payload.choices).toHaveLength(2);
  });

  it('C1: matching payload sent to the student excludes pairs (the answer map)', async () => {
    SECTIONS = [
      { id: 'sec1', chapter_test_id: 'ct1', section_order: 1, section_kind: 'matching', title: 'Match', time_minutes: 8, total_points: 10, power_skill: null },
    ];
    QUESTIONS = [
      {
        id: 'qmatch', section_id: 'sec1', student_id: 'stu1', question_order: 1, question_type: 'matching',
        question_text: 'Match them', points: 4,
        payload: {
          left: ['Term A', 'Term B'],
          right: ['Def 1', 'Def 2'],
          pairs: [{ left_idx: 0, right_idx: 1 }, { left_idx: 1, right_idx: 0 }],
        },
      },
    ];
    const POST = await load();
    const res = await POST(makeReq());
    const body = await res.json();
    const q = body.sections
      .flatMap((s: { questions: Array<{ id: string }> }) => s.questions)
      .find((qq: { id: string }) => qq.id === 'qmatch');
    expect(q.payload).not.toHaveProperty('pairs');
    // Display-safe left/right arrays are retained.
    expect(q.payload.left).toEqual(['Term A', 'Term B']);
    expect(q.payload.right).toEqual(['Def 1', 'Def 2']);
  });

  it('C1: open-type payload sent to the student excludes rubric / expected_signals / sample_answer', async () => {
    SECTIONS = [
      { id: 'sec1', chapter_test_id: 'ct1', section_order: 1, section_kind: 'short_answer', title: 'SA', time_minutes: 8, total_points: 10, power_skill: null },
    ];
    QUESTIONS = [
      {
        id: 'qopen', section_id: 'sec1', student_id: 'stu1', question_order: 1, question_type: 'short_answer',
        question_text: 'Explain', points: 5,
        payload: {
          prompt: 'Explain the theme',
          rubric: 'Must mention Z',
          expected_signals: ['Z', 'theme'],
          sample_answer: 'The theme is Z',
        },
      },
    ];
    const POST = await load();
    const res = await POST(makeReq());
    const body = await res.json();
    const q = body.sections
      .flatMap((s: { questions: Array<{ id: string }> }) => s.questions)
      .find((qq: { id: string }) => qq.id === 'qopen');
    expect(q.payload).not.toHaveProperty('rubric');
    expect(q.payload).not.toHaveProperty('expected_signals');
    expect(q.payload).not.toHaveProperty('sample_answer');
    // Display-safe prompt is retained.
    expect(q.payload.prompt).toBe('Explain the theme');
  });

  // ── I1: forfeit-via-start triggers grading ──────────────────────────────────

  it('I1: auto-forfeit registers an after() callback that grades the attempt', async () => {
    EXISTING_ATTEMPT = { ...FAKE_EXISTING_ATTEMPT, started_at: PAST_44_MIN, status: 'in_progress' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.forfeited).toBe(true);
    // A grading job is queued via after()…
    expect(afterCallbacks).toHaveLength(1);
    // …and running it grades the forfeited attempt.
    await afterCallbacks[0]();
    expect(gradeChapterAttemptMock).toHaveBeenCalledWith('att1', expect.anything());
  });

  it('I1: forfeit grading error does not propagate (non-fatal)', async () => {
    gradeChapterAttemptMock.mockRejectedValue(new Error('grading boom'));
    EXISTING_ATTEMPT = { ...FAKE_EXISTING_ATTEMPT, started_at: PAST_44_MIN, status: 'in_progress' };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(afterCallbacks).toHaveLength(1);
    await expect(afterCallbacks[0]()).resolves.not.toThrow();
  });

  // ── elapsed_seconds computed from started_at ──────────────────────────────

  it('elapsed_seconds reflects time since started_at for a resumed attempt', async () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    EXISTING_ATTEMPT = {
      ...FAKE_EXISTING_ATTEMPT,
      started_at: startedAt,
    };
    const POST = await load();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Elapsed should be roughly 300 seconds (5 min); allow ±10s for timing
    expect(body.elapsed_seconds).toBeGreaterThan(290);
    expect(body.elapsed_seconds).toBeLessThan(310);
  });
});
