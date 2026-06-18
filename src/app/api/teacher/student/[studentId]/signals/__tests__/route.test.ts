import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks (declared before any imports that trigger module loading) ──────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/auth/guards', () => ({
  guardStudentAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/utils/scoring', () => ({
  currentMasteryBand: vi.fn().mockReturnValue('grade_level'),
  bandIsVolatile: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/signals/computeHwQuizDivergence', () => ({
  computeHwQuizDivergence: vi.fn().mockReturnValue({
    divergence_score: 5,
    divergence_direction: 'aligned',
    divergence_trend: null,
    hw_avg: 78,
    quiz_avg: 80,
  }),
}));

vi.mock('@/lib/signals/computeRosterRiskIndex', () => ({
  computeRosterRiskIndex: vi.fn().mockReturnValue({
    risk_score: 30,
    risk_level: 'low',
    risk_factors: [],
  }),
}));

vi.mock('@/lib/signals/computeSessionRisk', () => ({
  computeSessionRisk: vi.fn().mockReturnValue({ score: 0.2, factors: [] }),
}));

vi.mock('@/lib/signals/diagnosis', () => ({
  findRecurringError: vi.fn().mockReturnValue(null),
  diagnose: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/signals/computeReteachEffectiveness', () => ({
  detectCompletedReteachCycles: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/signals/consistency', () => ({
  computeConsistency: vi.fn().mockReturnValue({
    consistency_score: 80,
    consistency_label: 'consistent',
  }),
  computeTrajectory: vi.fn().mockReturnValue({ trajectory: 'stable' }),
}));

// ── Lazy imports after mocks ─────────────────────────────────────────────────
import { GET } from '../route';
import { guardStudentAccess } from '@/lib/auth/guards';
import {
  createAdminSupabaseClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeParams(studentId: string) {
  return { params: Promise.resolve({ studentId }) };
}

/** Returns a mock admin client whose .from() chain returns empty arrays. */
function makeMockAdmin() {
  const chainBase = () => ({
    data: [],
    error: null,
    order: () => ({
      limit: () => ({ data: [], error: null }),
    }),
    maybeSingle: async () => ({ data: null, error: null }),
    in: () => ({ data: [], error: null }),
    single: async () => ({ data: null, error: null }),
    eq: () => chainBase(),
  });
  return {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => chainBase(),
        in: () => ({ data: [], error: null }),
      }),
    })),
  };
}

/** Server client with auth.getUser() returning a teacher + role query. */
function makeMockServer(role = 'teacher') {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'teacher1' } },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role }, error: null }),
        }),
      }),
    })),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/teacher/student/[studentId]/signals', () => {
  beforeEach(() => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin() as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeMockServer() as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    vi.mocked(guardStudentAccess).mockResolvedValue(null);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
      from: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>);

    const req = new NextRequest('http://localhost/api/teacher/student/s1/signals');
    const res = await GET(req, makeParams('s1'));
    expect(res.status).toBe(401);
  });

  // C8: student/parent role → 403 BEFORE guardStudentAccess
  it('C8: returns 403 when caller has student role', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeMockServer('student') as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    const req = new NextRequest('http://localhost/api/teacher/student/s1/signals');
    const res = await GET(req, makeParams('s1'));
    expect(res.status).toBe(403);
    // guard should NOT have been called (403 happens before it)
    expect(guardStudentAccess).not.toHaveBeenCalled();
  });

  it('C8: returns 403 when caller has parent role', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeMockServer('parent') as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    const req = new NextRequest('http://localhost/api/teacher/student/s1/signals');
    const res = await GET(req, makeParams('s1'));
    expect(res.status).toBe(403);
    expect(guardStudentAccess).not.toHaveBeenCalled();
  });

  it('C8: allows teacher role through to guard check', async () => {
    const req = new NextRequest('http://localhost/api/teacher/student/s1/signals');
    const res = await GET(req, makeParams('s1'));
    // teacher passes C8, guardStudentAccess was called
    expect(guardStudentAccess).toHaveBeenCalledWith('s1');
    expect(res.status).toBe(200);
  });

  it('returns guard response when guardStudentAccess rejects', async () => {
    const { NextResponse } = await import('next/server');
    vi.mocked(guardStudentAccess).mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const req = new NextRequest('http://localhost/api/teacher/student/s1/signals');
    const res = await GET(req, makeParams('s1'));
    expect(res.status).toBe(403);
  });

  it('returns 200 with bundle on valid auth + staff role + guard', async () => {
    const req = new NextRequest('http://localhost/api/teacher/student/s1/signals');
    const res = await GET(req, makeParams('s1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('current_band');
    expect(body).toHaveProperty('per_skill_cl');
    expect(body).toHaveProperty('divergence');
    expect(body).toHaveProperty('risk');
    expect(body).toHaveProperty('trajectory');
  });

  // CL verb mapping: null state → cl_display = "Not yet assessed"
  it('per_skill_cl maps null-verb states to "Not yet assessed" and real states correctly', async () => {
    const mockAdmin = makeMockAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockAdmin as any).from = vi.fn((table: string) => {
      if (table === 'skill_learning_state') {
        return {
          select: () => ({
            eq: () => ({
              data: [
                {
                  skill: { id: 'skill1', name: 'Fractions' },
                  state: 'insufficient_data',
                  confidence: 20,
                },
                {
                  skill: { id: 'skill2', name: 'Algebra' },
                  state: 'on_track',
                  confidence: 75,
                },
              ],
              error: null,
            }),
          }),
        };
      }
      // fallback — return empty for other tables
      return {
        select: () => ({
          eq: () => ({
            data: [],
            error: null,
            order: () => ({ limit: () => ({ data: [], error: null }) }),
            in: () => ({ data: [], error: null }),
            single: async () => ({ data: null, error: null }),
          }),
          in: () => ({ data: [], error: null }),
        }),
      };
    });

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      mockAdmin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const req = new NextRequest('http://localhost/api/teacher/student/s1/signals');
    const res = await GET(req, makeParams('s1'));
    const body = await res.json();

    const fractions = (
      body.per_skill_cl as Array<{
        skill_name: string;
        cl_verb: string | null;
        cl_display: string;
        confidence_label: string;
      }>
    ).find((s) => s.skill_name === 'Fractions');
    expect(fractions?.cl_verb).toBeNull();
    expect(fractions?.cl_display).toBe('Not yet assessed');

    const algebra = (
      body.per_skill_cl as Array<{
        skill_name: string;
        cl_verb: string;
        confidence_label: string;
      }>
    ).find((s) => s.skill_name === 'Algebra');
    expect(algebra?.cl_verb).toBe('On Track');
    // C correction: confidence should be SOFT WORD not a number (75 → 'consistent')
    expect(algebra?.confidence_label).toBe('consistent');
    expect(algebra?.confidence_label).not.toMatch(/^\d+$/);
  });

  it('risk object has roster and session fields (C3: live session risk)', async () => {
    const req = new NextRequest('http://localhost/api/teacher/student/s1/signals');
    const res = await GET(req, makeParams('s1'));
    const body = await res.json();
    expect(body.risk).toHaveProperty('roster');
    expect(body.risk).toHaveProperty('session');
  });
});
