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
  },
};

const FAKE_STUDENT = { full_name: 'Sam Student' };

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
 *   4. users.select('full_name').eq('id', student_id)      → studentRow
 *   5. [in after()] assignments.insert(...)                → inserted row
 *
 * Returns `{ mock, insertSpy }` so tests can inspect what was passed to assignments.insert
 * without re-calling from() (which would hand a fresh chain instance).
 */
function makeAdminMock(opts: {
  roleRow?: unknown;
  attempt?: unknown;
  asgRow?: unknown;
  studentRow?: unknown;
  insertError?: unknown;
} = {}) {
  const {
    roleRow = { role: 'teacher' },
    attempt = FAKE_ATTEMPT,
    asgRow = FAKE_ASSIGNMENT,
    studentRow = FAKE_STUDENT,
    insertError = null,
  } = opts;

  // Shared insert spy — accessible by the caller to assert what data was inserted.
  const insertSpy = vi.fn();
  const insertChain = makeChain({ id: 'new-asg-1' }, insertError);
  insertSpy.mockReturnValue(insertChain);

  // We need two separate users chain responses: one for role, one for student name.
  // Track call count on the users table to serve them in order.
  let userCallCount = 0;

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        userCallCount++;
        if (userCallCount === 1) return makeChain(roleRow); // role lookup
        return makeChain(studentRow);                        // student name lookup
      }
      if (table === 'homework_attempts') return makeChain(attempt);
      if (table === 'assignments') {
        // Return asgRow for the SELECT read; the shared insertSpy for the INSERT
        const readChain = makeChain(asgRow);
        readChain['insert'] = insertSpy;
        return readChain;
      }
      return makeChain(null);
    }),
  };

  return { mock, insertSpy };
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/teacher/assignments/reinforce', () => {
  beforeEach(() => {
    capturedAfterCallback = null;
    mockGuardClassAccess.mockReset();
    mockGenerateAssignment.mockReset();
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
});
