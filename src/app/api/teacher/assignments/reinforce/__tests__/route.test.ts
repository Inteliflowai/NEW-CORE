// src/app/api/teacher/assignments/reinforce/__tests__/route.test.ts
// Tests for POST /api/teacher/assignments/reinforce
//
// Cases:
//   - 401 no user
//   - 403 wrong role
//   - 403 when guardClassAccess denies (generateAssignment NOT called)
//   - 404 attempt not found
//   - 404 assignment not found
//   - Happy path: returns 202 immediately; after() callback calls generateAssignment with
//     band='reteach' and inserts an assignments row with status='draft' + mastery_band='reteach'
//   - SPARK: when getSparkLink returns a link, after() calls notifyAssignmentCreated with
//     band='reteach' + new assignment id + writes spark_status
//   - SPARK: when getSparkLink returns null, no notify happens but the assignment is still inserted
//   - SPARK: a thrown SPARK error is swallowed; assignment insert already happened
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown> = { attempt_id: 'ha-1' }): NextRequest {
  return new NextRequest('http://localhost/api/teacher/assignments/reinforce', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

const FAKE_ATTEMPT = {
  id: 'ha-1',
  assignment_id: 'asg-1',
  student_id: 'stu-1',
};

const FAKE_ASSIGNMENT = {
  id: 'asg-1',
  class_id: 'cls-1',
  lesson_id: 'les-1',
  learning_style: 'visual',
  lessons: {
    parsed_content: { summary: 'Fractions basics', key_concepts: ['numerator'] },
    title: 'Fractions',
    subject: 'Math',
    grade_level: '5',
  },
};

const FAKE_STUDENT = {
  full_name: 'Sam Student',
  school_id: 'sch-1',
  grade_level: '5',
};

const FAKE_GENERATED = {
  title: 'Reinforce: Fractions',
  mode: 'scaffolded',
  learning_style: 'visual',
  reading_passage: 'Fractions are parts.',
  audio_script: null,
  diagram_mode: 'image',
  diagram_description: 'pizza',
  diagram_svg_prompt: null,
  diagram_image_prompt: 'pizza slices',
  youtube_search_query: 'fractions intro',
  instructions: 'Do the tasks.',
  tasks: [
    { step: 1, description: 'Draw a fraction', type: 'draw', strategy: 'Idea Mapping', atl_skill: 'Thinking', ib_attribute: 'Thinkers', bloom_level: 'Understand' },
  ],
  support_note: 'Take your time.',
  atl_summary: ['Thinking'],
  ib_attributes: ['Thinkers'],
};

const FAKE_SPARK_RESULT = {
  success: true,
  sparkAssignmentId: 'spark-asg-1',
  sparkAttemptId: 'spark-att-1',
  syntheticExperimentId: 'spark-exp-1',
};

// ─── Supabase chain helpers ───────────────────────────────────────────────────

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

/**
 * Build admin Supabase mock for the reinforce route.
 * The route does:
 *   1. users.select('role').eq('id', user.id)              → roleRow
 *   2. homework_attempts.select(...).eq('id', attempt_id)  → attempt
 *   3. assignments.select(...).eq('id', assignment_id)     → asgRow (with lessons join)
 *   4. users.select('full_name, school_id, grade_level').eq('id', student_id) → studentRow
 *   5. [in after()] assignments.insert(...).select('id').single() → inserted row
 *   6. [in after()] assignments.update({spark_*}).eq('id', new_id) → spark fields update
 *
 * Returns `{ mock, insertSpy, updateSpy }` so tests can inspect what was passed.
 */
function makeAdminMock(opts: {
  roleRow?: unknown;
  attempt?: unknown;
  asgRow?: unknown;
  studentRow?: unknown;
  insertError?: unknown;
  insertedId?: string;
} = {}) {
  const {
    roleRow = { role: 'teacher' },
    attempt = FAKE_ATTEMPT,
    asgRow = FAKE_ASSIGNMENT,
    studentRow = FAKE_STUDENT,
    insertError = null,
    insertedId = 'new-asg-1',
  } = opts;

  // Shared insert spy — accessible by the caller to assert what data was inserted.
  const insertSpy = vi.fn();
  const insertChain = makeChain({ id: insertedId }, insertError);
  insertSpy.mockReturnValue(insertChain);

  // Shared update spy — accessible to assert spark_* fields were written.
  const updateSpy = vi.fn();
  const updateChain = makeChain(null, null);
  updateSpy.mockReturnValue(updateChain);

  // We need two separate users chain responses: one for role, one for student.
  // Track call count on the users table to serve them in order.
  let userCallCount = 0;

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        userCallCount++;
        if (userCallCount === 1) return makeChain(roleRow); // role lookup
        return makeChain(studentRow);                        // student lookup
      }
      if (table === 'homework_attempts') return makeChain(attempt);
      if (table === 'assignments') {
        // Return asgRow for the SELECT read; the shared insertSpy for INSERT; updateSpy for UPDATE
        const readChain = makeChain(asgRow);
        readChain['insert'] = insertSpy;
        readChain['update'] = updateSpy;
        return readChain;
      }
      if (table === 'platform_links') return makeChain(null);
      return makeChain(null);
    }),
  };

  return { mock, insertSpy, updateSpy };
}

// ─── Capture after() callback ────────────────────────────────────────────────

/** The captured after-callback (populated by the mock). Call it to run the background work. */
let capturedAfterCallback: (() => Promise<void>) | null = null;

vi.mock('next/server', async (importOriginal) => {
  const real = await importOriginal<typeof import('next/server')>();
  return {
    ...real,
    after: vi.fn((cb: () => Promise<void>) => {
      capturedAfterCallback = cb;
    }),
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const mockGuardClassAccess = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardClassAccess: (...a: unknown[]) => mockGuardClassAccess(...a),
}));

const mockGenerateAssignment = vi.fn();
vi.mock('@/lib/engine/assignmentGen', () => ({
  generateAssignment: (...a: unknown[]) => mockGenerateAssignment(...a),
}));

const mockGetSparkLink = vi.fn();
vi.mock('@/lib/spark/sparkLink', () => ({
  getSparkLink: (...a: unknown[]) => mockGetSparkLink(...a),
}));

const mockNotifyAssignmentCreated = vi.fn();
vi.mock('@/lib/spark/notifyAssignmentCreated', () => ({
  notifyAssignmentCreated: (...a: unknown[]) => mockNotifyAssignmentCreated(...a),
}));

const mockResolveLessonSkills = vi.fn();
vi.mock('@/lib/lessons/resolveLessonSkills', () => ({
  resolveLessonSkills: (...a: unknown[]) => mockResolveLessonSkills(...a),
}));

const mockLoadSkillTargets = vi.fn();
vi.mock('@/lib/skills/loadSkillTargets', () => ({
  loadSkillTargets: (...a: unknown[]) => mockLoadSkillTargets(...a),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/teacher/assignments/reinforce', () => {
  beforeEach(() => {
    capturedAfterCallback = null;
    mockGuardClassAccess.mockReset();
    mockGenerateAssignment.mockReset();
    mockGetSparkLink.mockReset();
    mockNotifyAssignmentCreated.mockReset();
    mockResolveLessonSkills.mockReset();
    mockLoadSkillTargets.mockReset();
    // Safe defaults so existing tests that invoke after() don't fail on the new calls
    mockResolveLessonSkills.mockResolvedValue([]);
    mockLoadSkillTargets.mockResolvedValue([]);
    vi.resetModules();
  });

  // ── 401 no user ─────────────────────────────────────────────────────────────
  it('returns 401 when user is not authenticated', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    } as never);
    const { mock } = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockGenerateAssignment).not.toHaveBeenCalled();
  });

  // ── 403 wrong role ──────────────────────────────────────────────────────────
  it('returns 403 when the user role is not a staff role', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock } = makeAdminMock({ roleRow: { role: 'student' } });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(mockGenerateAssignment).not.toHaveBeenCalled();
  });

  // ── 404 attempt not found ────────────────────────────────────────────────────
  it('returns 404 when the homework attempt is not found', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock } = makeAdminMock({ attempt: null });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);
    mockGuardClassAccess.mockResolvedValue(null);

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(mockGenerateAssignment).not.toHaveBeenCalled();
  });

  // ── 404 assignment not found ─────────────────────────────────────────────────
  it('returns 404 when the assignment is not found', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock } = makeAdminMock({ asgRow: null });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);
    mockGuardClassAccess.mockResolvedValue(null);

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(mockGenerateAssignment).not.toHaveBeenCalled();
  });

  // ── 403 guardClassAccess denies — generateAssignment NOT called ──────────────
  it('returns 403 when guardClassAccess denies, generateAssignment not called', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock } = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);
    const { NextResponse } = await import('next/server');
    mockGuardClassAccess.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(mockGenerateAssignment).not.toHaveBeenCalled();
    // after() should NOT have been called either
    expect(capturedAfterCallback).toBeNull();
  });

  // ── Happy path: 202 immediately + after() generates with band='reteach' ─────
  it('returns 202 immediately and the after() callback calls generateAssignment with band=reteach and inserts status=draft + mastery_band=reteach', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock, insertSpy } = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);
    mockGuardClassAccess.mockResolvedValue(null);
    mockGenerateAssignment.mockResolvedValue(FAKE_GENERATED);
    mockGetSparkLink.mockResolvedValue(null); // no SPARK for this test

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    const res = await POST(makeRequest({ attempt_id: 'ha-1' }));

    // 202 returned immediately (before background work)
    expect(res.status).toBe(202);
    const resBody = await res.json();
    expect(resBody).toEqual({ ok: true, status: 'creating' });

    // after() callback was captured
    expect(capturedAfterCallback).not.toBeNull();
    // generateAssignment has NOT been called yet (after() hasn't run)
    expect(mockGenerateAssignment).not.toHaveBeenCalled();

    // Now invoke the captured callback to simulate the background execution
    await capturedAfterCallback!();

    // generateAssignment must have been called with band='reteach'
    expect(mockGenerateAssignment).toHaveBeenCalledOnce();
    const genCall = mockGenerateAssignment.mock.calls[0][0];
    expect(genCall.band).toBe('reteach');
    expect(genCall.studentName).toBe('Sam Student');
    expect(typeof genCall.lessonSummary).toBe('string');

    // assignments.insert must have been called with mastery_band='reteach' and status='draft'
    // Use the shared insertSpy captured from makeAdminMock
    expect(insertSpy).toHaveBeenCalledOnce();
    const insertData = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(insertData.mastery_band).toBe('reteach');
    expect(insertData.status).toBe('draft');
    expect(insertData.student_id).toBe('stu-1');
    expect(insertData.class_id).toBe('cls-1');
  });

  // ── after() LlmExhaustedError is swallowed (no throw) ────────────────────────
  it('after() swallows LlmExhaustedError — no uncaught rejection, no new row', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock } = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);
    mockGuardClassAccess.mockResolvedValue(null);

    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    mockGenerateAssignment.mockRejectedValue(new LlmExhaustedError('claude+openai'));

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(202);

    // Invoking the callback must NOT throw
    await expect(capturedAfterCallback!()).resolves.toBeUndefined();
  });

  // ── SPARK: link exists → notifyAssignmentCreated called with band='reteach' ──
  it('after(): when SPARK link exists, calls notifyAssignmentCreated with band=reteach + new id and writes spark_status', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock, insertSpy, updateSpy } = makeAdminMock({ insertedId: 'new-asg-42' });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);
    mockGuardClassAccess.mockResolvedValue(null);
    mockGenerateAssignment.mockResolvedValue(FAKE_GENERATED);
    mockGetSparkLink.mockResolvedValue({ api_key: 'k', core_base_url: 'https://spark.test', enabled: true });
    mockNotifyAssignmentCreated.mockResolvedValue(FAKE_SPARK_RESULT);

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    await POST(makeRequest({ attempt_id: 'ha-1' }));
    await capturedAfterCallback!();

    // insert was called
    expect(insertSpy).toHaveBeenCalledOnce();

    // getSparkLink was called with the school_id from the student row
    expect(mockGetSparkLink).toHaveBeenCalledOnce();
    expect(mockGetSparkLink.mock.calls[0][1]).toBe('sch-1');

    // notifyAssignmentCreated was called with the right shape
    expect(mockNotifyAssignmentCreated).toHaveBeenCalledOnce();
    const notifyArg = mockNotifyAssignmentCreated.mock.calls[0][0] as Record<string, unknown>;
    expect(notifyArg.coreHomeworkId).toBe('new-asg-42');
    expect(notifyArg.studentId).toBe('stu-1');
    expect(notifyArg.schoolId).toBe('sch-1');
    expect(notifyArg.coreClassId).toBe('cls-1');
    expect(notifyArg.band).toBe('reteach');

    // update was called to write spark fields
    expect(updateSpy).toHaveBeenCalledOnce();
    const updateData = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(updateData.spark_assignment_id).toBe('spark-asg-1');
    expect(updateData.spark_status).toBe('created');
  });

  // ── SPARK: no link → notify NOT called, assignment still inserted ─────────────
  it('after(): when getSparkLink returns null, notifyAssignmentCreated is not called and the assignment is still inserted', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock, insertSpy } = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);
    mockGuardClassAccess.mockResolvedValue(null);
    mockGenerateAssignment.mockResolvedValue(FAKE_GENERATED);
    mockGetSparkLink.mockResolvedValue(null); // no SPARK school

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    await POST(makeRequest({ attempt_id: 'ha-1' }));
    await capturedAfterCallback!();

    // insert still happened
    expect(insertSpy).toHaveBeenCalledOnce();

    // notify was NOT called
    expect(mockNotifyAssignmentCreated).not.toHaveBeenCalled();
  });

  // ── SPARK: thrown SPARK error is swallowed, assignment insert already done ───
  it('after(): a thrown SPARK error is swallowed and does not undo the assignment insert', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock, insertSpy } = makeAdminMock({ insertedId: 'new-asg-99' });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);
    mockGuardClassAccess.mockResolvedValue(null);
    mockGenerateAssignment.mockResolvedValue(FAKE_GENERATED);
    mockGetSparkLink.mockResolvedValue({ api_key: 'k', core_base_url: 'https://spark.test', enabled: true });
    mockNotifyAssignmentCreated.mockRejectedValue(new Error('SPARK exploded'));

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    await POST(makeRequest({ attempt_id: 'ha-1' }));

    // must not throw
    await expect(capturedAfterCallback!()).resolves.toBeUndefined();

    // insert happened before the SPARK call — it is done
    expect(insertSpy).toHaveBeenCalledOnce();
  });

  // ── CL targets: skillTargets threaded + skill_ids persisted (tagged lesson) ──
  it('threads skillTargets and persists skill_ids on the reinforced assignment', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock, insertSpy } = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);
    mockGuardClassAccess.mockResolvedValue(null);
    mockGenerateAssignment.mockResolvedValue(FAKE_GENERATED);
    mockGetSparkLink.mockResolvedValue(null);

    // lesson resolves to a single tagged skill
    mockResolveLessonSkills.mockResolvedValue([{ skill_id: 'frac', skill_name: 'Fractions' }]);
    mockLoadSkillTargets.mockResolvedValue([
      { skill_id: 'frac', skill_name: 'Fractions', level: 'scaffolded', verb: 'Reinforce', confident: true },
    ]);

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    await POST(makeRequest({ attempt_id: 'ha-1' }));
    await capturedAfterCallback!();

    // generateAssignment was called with band='reteach' and skillTargets of length >= 1
    const genArg = mockGenerateAssignment.mock.calls[0][0] as Record<string, unknown>;
    expect(genArg.band).toBe('reteach');
    expect(((genArg.skillTargets ?? []) as unknown[]).length).toBeGreaterThanOrEqual(1);

    // insert captured the resolved skill_ids
    const insertData = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(insertData.skill_ids).toEqual(['frac']);
  });

  // ── CL targets: untagged lesson → skill_ids=[] but row still inserted ─────────
  it('still creates a reinforced assignment with skill_ids=[] when the lesson is untagged', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const { mock, insertSpy } = makeAdminMock();
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mock as never);
    mockGuardClassAccess.mockResolvedValue(null);
    mockGenerateAssignment.mockResolvedValue(FAKE_GENERATED);
    mockGetSparkLink.mockResolvedValue(null);

    // defaults from beforeEach: resolveLessonSkills → [], loadSkillTargets → []

    const { POST } = await import('@/app/api/teacher/assignments/reinforce/route');
    await POST(makeRequest({ attempt_id: 'ha-1' }));
    await capturedAfterCallback!();

    // a row was still inserted
    expect(insertSpy).toHaveBeenCalledOnce();
    // skill_ids must be an empty array
    const insertData = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(insertData.skill_ids).toEqual([]);
  });
});
