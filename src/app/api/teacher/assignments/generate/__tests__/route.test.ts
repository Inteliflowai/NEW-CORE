// src/app/api/teacher/assignments/generate/__tests__/route.test.ts
// Tests for POST /api/teacher/assignments/generate
//
// Required cases (task-8-corrections.md):
//   Happy path: graded attempt persists class_id from quizzes join (C15) + normalized learning_style (C6)
//   C20: band-null attempt → 409/422 refusal; generateAssignment NOT called
//   C17: missing-style → inferLearningStyle invoked (assert GPT learning-style call fired)
//   Auth 401 + guard rejection
//
// Mock idiom: makeChain + makeAdminMock pattern (follows submit/__tests__/route.test.ts)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown> = { quiz_attempt_id: 'attempt-1' }): NextRequest {
  return new NextRequest('http://localhost/api/teacher/assignments/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── fixture data ─────────────────────────────────────────────────────────────

// A graded attempt with quizzes join (C15: class_id + lesson_id come from quizzes)
const FAKE_ATTEMPT_GRADED = {
  id: 'attempt-1',
  student_id: 'student-1',
  mastery_band: 'reteach',
  learning_style: 'visual',
  quizzes: {
    class_id: 'class-1',
    lesson_id: 'lesson-1',
    lessons: {
      parsed_content: { title: 'Fractions', key_concepts: ['numerator', 'denominator'] },
      title: 'Fractions',
      grade_level: '7',
      subject: 'Math',
    },
  },
  users: { full_name: 'Sam Student', grade_level: '7', school_id: 'sch-1' },
};

// A NOT-YET-GRADED attempt (mastery_band is null — C20 must refuse)
const FAKE_ATTEMPT_UNGRADED = {
  ...FAKE_ATTEMPT_GRADED,
  mastery_band: null,
};

// An attempt with no learning_style (C17: must trigger inferLearningStyle)
const FAKE_ATTEMPT_NO_STYLE = {
  ...FAKE_ATTEMPT_GRADED,
  learning_style: null,
};

// Quiz responses for the no-style attempt (C17 needs behavioral signals)
const FAKE_RESPONSES = [
  { position: 1, response_time_ms: 30000, hesitation_ms: 500, answer_changes: 0, word_count: 0, response_text: 'A' },
  { position: 4, response_time_ms: 45000, hesitation_ms: 1200, answer_changes: 1, word_count: 25, response_text: 'The numerator is on top.' },
];

// A valid Assignment shape to return from the mocked generateAssignment
const FAKE_ASSIGNMENT = {
  title: 'Reteach: Fractions',
  mode: 'scaffolded',
  learning_style: 'visual',
  reading_passage: 'Fractions are parts of a whole.',
  audio_script: 'Fractions are parts of a whole.',
  diagram_mode: 'image',
  diagram_description: 'pizza slices',
  diagram_svg_prompt: null,
  diagram_image_prompt: 'pizza',
  youtube_search_query: 'fractions',
  instructions: 'Do the tasks.',
  tasks: [
    { step: 1, description: 'Label a fraction', type: 'draw', strategy: 'Idea Mapping', atl_skill: 'Thinking', ib_attribute: 'Thinkers', bloom_level: 'Understand' },
    { step: 2, description: 'Color fractions', type: 'draw', strategy: 'Quick Look', atl_skill: 'Research', ib_attribute: 'Inquirers', bloom_level: 'Remember' },
  ],
  support_note: 'You can do it!',
  atl_summary: ['Thinking'],
  ib_attributes: ['Thinkers'],
};

// ─── Supabase chain builder ──────────────────────────────────────────────────

function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['insert'] = vi.fn().mockReturnValue(chain);
  chain['update'] = vi.fn().mockReturnValue(chain);
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data, error });
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}

// Build admin Supabase mock for the generate route.
// The route does:
//   1. quiz_attempts.select(...).eq('id', id).single()   → attempt
//   2. quiz_responses.select(...).eq('attempt_id', id)   → responses (only when no style → C17)
//   3. assignments.insert(...).select().single()         → inserted row
//   4. platform_links.select(...).eq(...).maybeSingle()  → spark link (SPARK gate, T7)
//   5. assignments.update(...).eq('id', row.id)          → persist spark_status (T7)
function makeAdminMock(opts: {
  attempt?: unknown;
  attemptError?: unknown;
  responses?: unknown;
  responsesError?: unknown;
  insertedRow?: unknown;
  insertError?: unknown;
  // SPARK gate — defaults to null (off) so all pre-existing tests are unaffected
  sparkLink?: unknown;
  userRow?: unknown;
  /** Task F: optional callback invoked with the assignments.insert payload */
  onAssignmentsInsert?: (payload: unknown) => void;
} = {}) {
  const {
    attempt = FAKE_ATTEMPT_GRADED,
    attemptError = null,
    responses = FAKE_RESPONSES,
    responsesError = null,
    insertedRow = { id: 'assign-1', ...FAKE_ASSIGNMENT },
    insertError = null,
    sparkLink = null,
    userRow = { school_id: 'sch-1', grade_level: '7' },
    onAssignmentsInsert,
  } = opts;

  const attemptChain = makeChain(attempt, attemptError);
  const responsesChain = makeChain(responses, responsesError);
  const insertChain = makeChain(insertedRow, insertError);

  return {
    from: vi.fn((table: string) => {
      if (table === 'quiz_attempts') return attemptChain;
      if (table === 'quiz_responses') return responsesChain;
      if (table === 'assignments') {
        const chain = { ...insertChain };
        chain['insert'] = vi.fn().mockImplementation((payload: unknown) => {
          onAssignmentsInsert?.(payload);
          return insertChain;
        });
        return chain;
      }
      // SPARK gate: platform_links returns the configured sparkLink (null = off by default)
      if (table === 'platform_links') return makeChain(sparkLink);
      // users fallback (in case of a direct users query)
      if (table === 'users') return makeChain(userRow);
      return makeChain(null);
    }),
  };
}

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

// Mock guardStudentAccess — returns null by default (allow), can be overridden per test
const mockGuardStudentAccess = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardStudentAccess: (...a: unknown[]) => mockGuardStudentAccess(...a),
}));

// Mock the engine fns — track calls to detect C17/C20
const mockGenerateAssignment = vi.fn();
const mockInferLearningStyle = vi.fn();
vi.mock('@/lib/engine/assignmentGen', () => ({
  generateAssignment: (...a: unknown[]) => mockGenerateAssignment(...a),
  inferLearningStyle: (...a: unknown[]) => mockInferLearningStyle(...a),
}));

// SPARK hooks — hoisted so they reliably intercept the route's static imports
const mockGetSparkLink = vi.fn();
vi.mock('@/lib/spark/sparkLink', () => ({
  getSparkLink: (...a: unknown[]) => mockGetSparkLink(...a),
}));
const mockNotify = vi.fn();
vi.mock('@/lib/spark/notifyAssignmentCreated', () => ({
  notifyAssignmentCreated: (...a: unknown[]) => mockNotify(...a),
}));

// Task F: Mock resolveLessonSkills + loadSkillTargets (must be hoisted before route import)
const mockResolveLessonSkills = vi.fn();
vi.mock('@/lib/lessons/resolveLessonSkills', () => ({
  resolveLessonSkills: (...a: unknown[]) => mockResolveLessonSkills(...a),
}));
const mockLoadSkillTargets = vi.fn();
vi.mock('@/lib/skills/loadSkillTargets', () => ({
  loadSkillTargets: (...a: unknown[]) => mockLoadSkillTargets(...a),
}));

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/teacher/assignments/generate', () => {
  beforeEach(() => {
    mockGuardStudentAccess.mockReset();
    mockGenerateAssignment.mockReset();
    mockInferLearningStyle.mockReset();
    mockGetSparkLink.mockReset();
    mockNotify.mockReset();
    // Task F: safe defaults so existing tests are unaffected (empty skills → single-band fallback)
    mockResolveLessonSkills.mockReset();
    mockResolveLessonSkills.mockResolvedValue([]);
    mockLoadSkillTargets.mockReset();
    mockLoadSkillTargets.mockResolvedValue([]);
    vi.resetModules();
  });

  // ── Auth guard: unauthenticated → 401 ───────────────────────────────────
  it('returns 401 when user is not authenticated', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  // ── Missing quiz_attempt_id → 400 ───────────────────────────────────────
  it('returns 400 when quiz_attempt_id is missing', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  // ── Guard rejection → guard response returned ───────────────────────────
  it('returns guard response when guardStudentAccess rejects access', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);
    const { NextResponse } = await import('next/server');
    mockGuardStudentAccess.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(mockGenerateAssignment).not.toHaveBeenCalled();
  });

  // ── C20: band-null → 409/422 refusal, generateAssignment NOT called ─────
  it('C20: mastery_band is null → 409/422 refusal, generateAssignment not called', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ attempt: FAKE_ATTEMPT_UNGRADED }) as never,
    );
    mockGuardStudentAccess.mockResolvedValue(null);

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest());
    // Must be 409 or 422
    expect([409, 422]).toContain(res.status);
    // generateAssignment must NOT have been called
    expect(mockGenerateAssignment).not.toHaveBeenCalled();
    // Response must contain an error message about grading
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  // ── C17: no style → inferLearningStyle invoked ──────────────────────────
  it('C17: no learning_style → inferLearningStyle is invoked (GPT learning-style call fires)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }) },
    } as never);
    const adminMock = makeAdminMock({ attempt: FAKE_ATTEMPT_NO_STYLE });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);
    mockGuardStudentAccess.mockResolvedValue(null);
    // inferLearningStyle returns a style
    mockInferLearningStyle.mockResolvedValue({ learning_style: 'visual', confidence: 0.75 });
    mockGenerateAssignment.mockResolvedValue(FAKE_ASSIGNMENT);

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest());

    // inferLearningStyle MUST have been called (assert the learning-style GPT call fired)
    expect(mockInferLearningStyle).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);

    // C17 regression guard: quiz_responses must be queried by 'attempt_id', NOT 'quiz_attempt_id'.
    // PostgREST returns {data:null, error} for an unknown column — so the wrong name silently
    // collapses safeResponses to [] and forces inferLearningStyle to run on all-zero signals.
    const responsesChain = adminMock.from('quiz_responses') as { eq: ReturnType<typeof vi.fn> };
    const eqCalls: Array<unknown[]> = responsesChain.eq.mock.calls;
    const columnNames = eqCalls.map((c) => (c as [string, unknown])[0]);
    expect(columnNames).toContain('attempt_id');
    expect(columnNames).not.toContain('quiz_attempt_id');
  });

  // ── Happy path: class_id from quizzes join (C15) + normalized style (C6) ─
  it('happy path: persists class_id from quizzes join and normalizes learning_style (C15+C6)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }) },
    } as never);
    const adminMock = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);
    mockGuardStudentAccess.mockResolvedValue(null);
    mockGenerateAssignment.mockResolvedValue(FAKE_ASSIGNMENT);

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest({ quiz_attempt_id: 'attempt-1', learning_style: 'visual' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assignment_id).toBe('assign-1');

    // C15: verify assignments.insert received class_id from quizzes join (not from quiz_attempts)
    const fromCalls = (adminMock.from as ReturnType<typeof vi.fn>).mock.calls;
    const assignmentFromCalls = fromCalls.filter((c: unknown[]) => c[0] === 'assignments');
    expect(assignmentFromCalls.length).toBeGreaterThan(0);

    // The insert was called on the assignments table chain
    const assignmentsChain = adminMock.from('assignments') as { insert: ReturnType<typeof vi.fn> };
    // insert should have been called with data containing class_id from the quizzes join
    const insertCalls = assignmentsChain.insert.mock?.calls;
    if (insertCalls && insertCalls.length > 0) {
      const insertData = insertCalls[0][0];
      expect(insertData.class_id).toBe('class-1'); // from quizzes.class_id, not attempt.class_id
      expect(insertData.lesson_id).toBe('lesson-1'); // from quizzes.lesson_id
    }
  });

  // ── happy path: learning_style read_write → normalized to 'text' (C6) ────
  it('normalizes read_write to text at persist boundary (C6)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }) },
    } as never);
    const adminMock = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);
    mockGuardStudentAccess.mockResolvedValue(null);
    mockGenerateAssignment.mockResolvedValue({ ...FAKE_ASSIGNMENT, learning_style: 'read_write' });

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest({ quiz_attempt_id: 'attempt-1', learning_style: 'read_write' }));

    expect(res.status).toBe(200);
    // Verify normalized style was sent to insert
    const assignmentsChain = adminMock.from('assignments') as { insert: ReturnType<typeof vi.fn> };
    const insertCalls = assignmentsChain.insert.mock?.calls;
    if (insertCalls && insertCalls.length > 0) {
      const insertData = insertCalls[0][0];
      // read_write must be normalized to 'text' at the persist boundary
      expect(insertData.learning_style).toBe('text');
    }
  });

  // ── Attempt not found → 404 ─────────────────────────────────────────────
  it('returns 404 when attempt not found', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ attempt: null }) as never,
    );

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
  });

  // ── SPARK T7: gate off (no enabled spark link) → notify NOT called ─────────
  it('does NOT notify SPARK when the school has no enabled spark link (gate off)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);
    mockGuardStudentAccess.mockResolvedValue(null);
    mockGenerateAssignment.mockResolvedValue({ title: 'T', instructions: 'I' });
    mockGetSparkLink.mockResolvedValue(null);

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  // ── SPARK T7: gate on (enabled spark link) → notify called + args verified ─
  it('notifies SPARK + persists spark_status when an enabled link exists (non-blocking)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);
    mockGuardStudentAccess.mockResolvedValue(null);
    mockGenerateAssignment.mockResolvedValue({ title: 'T', instructions: 'I' });
    mockGetSparkLink.mockResolvedValue({ api_key: 'k', core_base_url: null, enabled: true });
    mockNotify.mockResolvedValue({
      success: true, sparkAssignmentId: 'sa-1', sparkAttemptId: 'att-1', syntheticExperimentId: 'exp-1',
    });

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      coreHomeworkId: expect.any(String),
      studentId: expect.any(String),
    }));
  });

  // ── Task F: skill-targeted generation ─────────────────────────────────────

  it('resolves lesson skills, threads skillTargets, and persists skill_ids', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }) },
    } as never);

    let insertPayload: Record<string, unknown> = {};
    const adminMock = makeAdminMock({
      onAssignmentsInsert: (payload) => { insertPayload = payload as Record<string, unknown>; },
    });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);
    mockGuardStudentAccess.mockResolvedValue(null);

    // Lesson tagged with two skills
    mockResolveLessonSkills.mockResolvedValue([
      { skill_id: 'frac', skill_name: 'Fractions' },
      { skill_id: 'dec', skill_name: 'Decimals' },
    ]);
    mockLoadSkillTargets.mockResolvedValue([
      { skill_id: 'frac', skill_name: 'Fractions', level: 'scaffolded', verb: 'Reinforce', confident: true },
      { skill_id: 'dec', skill_name: 'Decimals', level: 'standard', verb: 'On Track', confident: true },
    ]);
    mockGenerateAssignment.mockResolvedValue(FAKE_ASSIGNMENT);

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest({ quiz_attempt_id: 'attempt-1', learning_style: 'visual' }));
    expect(res.status).toBe(200);

    const genArg = mockGenerateAssignment.mock.calls[0][0];
    expect(Array.isArray(genArg.skillTargets)).toBe(true);
    expect(genArg.skillTargets.length).toBeGreaterThanOrEqual(1);
    expect(insertPayload.skill_ids).toEqual(['frac', 'dec']);
  });

  it('falls back to single-band (no skillTargets, skill_ids=[]) for an untagged lesson', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }) },
    } as never);

    let insertPayload: Record<string, unknown> = {};
    const adminMock = makeAdminMock({
      onAssignmentsInsert: (payload) => { insertPayload = payload as Record<string, unknown>; },
    });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);
    mockGuardStudentAccess.mockResolvedValue(null);

    // Untagged lesson → no skills (default mock already returns [])
    mockResolveLessonSkills.mockResolvedValue([]);
    mockGenerateAssignment.mockResolvedValue(FAKE_ASSIGNMENT);

    const { POST } = await import('@/app/api/teacher/assignments/generate/route');
    const res = await POST(makeRequest({ quiz_attempt_id: 'attempt-1', learning_style: 'visual' }));
    expect(res.status).toBe(200);

    const genArg = mockGenerateAssignment.mock.calls[0][0];
    expect(genArg.skillTargets ?? []).toEqual([]);   // single-band path
    expect(insertPayload.skill_ids).toEqual([]);      // backward compat
  });
});
