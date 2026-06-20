// src/app/api/attempts/spark-launch/__tests__/route.test.ts
// Tests for POST /api/attempts/spark-launch
//
// Node idiom: hoisted vi.mock of @/lib/supabase/server + @/lib/spark/signLaunchJwt;
// dynamic import of the route after mocks.  Mirrors the teacher/assignments/generate pattern.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown> = { assignment_id: 'assign-1' }): NextRequest {
  return new NextRequest('http://localhost/api/attempts/spark-launch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', origin: 'http://localhost' },
  });
}

function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'insert', 'update', 'upsert', 'limit']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data, error });
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve);
  return chain;
}

// ─── module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

// Mock signLaunchJwt so tests don't need the real secret to verify JWT structure.
const mockSignLaunchJwt = vi.fn().mockReturnValue('mock.jwt.token');
vi.mock('@/lib/spark/signLaunchJwt', () => ({
  signLaunchJwt: (...a: unknown[]) => mockSignLaunchJwt(...a),
}));

// ─── admin mock builder ───────────────────────────────────────────────────────

const FAKE_ASSIGNMENT = {
  id: 'assign-1',
  student_id: 'student-1',
  spark_attempt_id: 'spark-attempt-42',
};

const FAKE_STUDENT = {
  id: 'student-1',
  full_name: 'Ada Lovelace',
  email: 'ada@school.com',
  school_id: 'school-1',
};

const FAKE_ENROLLMENT = {
  class: { grade_level: '8' },
};

function makeAdminMock(opts: {
  assignment?: unknown;
  student?: unknown;
  enrollment?: unknown;
} = {}) {
  const {
    assignment = FAKE_ASSIGNMENT,
    student = FAKE_STUDENT,
    enrollment = FAKE_ENROLLMENT,
  } = opts;

  return {
    from: vi.fn((table: string) => {
      if (table === 'assignments') return makeChain(assignment);
      if (table === 'users') return makeChain(student);
      if (table === 'enrollments') return makeChain(enrollment);
      return makeChain(null);
    }),
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/attempts/spark-launch', () => {
  beforeEach(() => {
    process.env.CORE_SPARK_API_SECRET = 'test-spark-secret';
    process.env.SPARK_API_URL = 'https://spark.test';
    mockSignLaunchJwt.mockClear();
    vi.resetModules();
  });

  // ── 401: no authenticated user ────────────────────────────────────────────
  it('returns 401 when user is not authenticated', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

    const { POST } = await import('@/app/api/attempts/spark-launch/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  // ── 403: assignment belongs to a different student ────────────────────────
  it('returns 403 when the assignment belongs to a different student', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'OTHER-student' } }, error: null }) },
    } as never);
    // assignment.student_id = 'student-1', user.id = 'OTHER-student' → mismatch
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);

    const { POST } = await import('@/app/api/attempts/spark-launch/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  // ── 400: assignment has no spark_attempt_id ───────────────────────────────
  it('returns 400 when assignment has no spark_attempt_id', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ assignment: { id: 'assign-1', student_id: 'student-1', spark_attempt_id: null } }) as never,
    );

    const { POST } = await import('@/app/api/attempts/spark-launch/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/spark not provisioned/i);
  });

  // ── 400: student has null school_id ──────────────────────────────────────
  it('returns 400 when student school_id is null', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeAdminMock({ student: { ...FAKE_STUDENT, school_id: null } }) as never,
    );

    const { POST } = await import('@/app/api/attempts/spark-launch/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/school not linked/i);
  });

  // ── 200: happy path — returns correct launch_url ─────────────────────────
  it('200: returns launch_url pointing to SPARK auth with signed token + encoded redirect', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(makeAdminMock() as never);
    mockSignLaunchJwt.mockReturnValue('signed.jwt.tok');

    const { POST } = await import('@/app/api/attempts/spark-launch/route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json() as { launch_url: string };
    const { launch_url } = body;

    // Must start with SPARK_API_URL + auth endpoint + token param
    expect(launch_url).toMatch(/^https:\/\/spark\.test\/api\/integration\/auth\?token=signed\.jwt\.tok/);

    // Must contain redirect= with URL-encoded /student/experiment/<spark_attempt_id>
    const expectedRedirect = encodeURIComponent('/student/experiment/spark-attempt-42');
    expect(launch_url).toContain(`redirect=${expectedRedirect}`);

    // signLaunchJwt must have been called with the right core claims
    expect(mockSignLaunchJwt).toHaveBeenCalledOnce();
    expect(mockSignLaunchJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        core_user_id: 'student-1',
        core_school_id: 'school-1',
        spark_attempt_id: 'spark-attempt-42',
      }),
    );
  });
});
