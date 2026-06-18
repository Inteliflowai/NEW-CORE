import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/auth/guards', () => ({
  guardClassAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/utils/scoring', () => ({
  currentMasteryBand: vi.fn().mockReturnValue('grade_level'),
  bandIsVolatile: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/signals/computeRosterRiskIndex', () => ({
  computeRosterRiskIndex: vi.fn().mockReturnValue({
    risk_score: 30,
    risk_level: 'low',
    risk_factors: [],
  }),
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

vi.mock('@/lib/signals/diagnosis', () => ({
  diagnose: vi.fn().mockReturnValue(null),
  findRecurringError: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/signals/conceptGapDetector', () => ({
  detectConceptGaps: vi.fn().mockReturnValue([]),
}));

// ── Lazy imports ─────────────────────────────────────────────────────────────
import { GET } from '../route';
import { guardClassAccess } from '@/lib/auth/guards';
import {
  createAdminSupabaseClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server';
import { diagnose } from '@/lib/signals/diagnosis';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeParams(classId: string) {
  return { params: Promise.resolve({ classId }) };
}

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

function makeMockAdmin() {
  const chainBase = () => ({
    data: [],
    error: null,
    order: () => ({ limit: () => ({ data: [], error: null }) }),
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/teacher/class/[classId]/roster-signals', () => {
  beforeEach(() => {
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdmin() as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeMockServer() as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    vi.mocked(guardClassAccess).mockResolvedValue(null);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
      from: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>);

    const req = new NextRequest('http://localhost/api/teacher/class/c1/roster-signals');
    const res = await GET(req, makeParams('c1'));
    expect(res.status).toBe(401);
  });

  // C8: student/parent → 403 BEFORE guardClassAccess
  it('C8: returns 403 when caller has student role', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeMockServer('student') as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    const req = new NextRequest('http://localhost/api/teacher/class/c1/roster-signals');
    const res = await GET(req, makeParams('c1'));
    expect(res.status).toBe(403);
    expect(guardClassAccess).not.toHaveBeenCalled();
  });

  it('C8: returns 403 when caller has parent role', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeMockServer('parent') as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>,
    );
    const req = new NextRequest('http://localhost/api/teacher/class/c1/roster-signals');
    const res = await GET(req, makeParams('c1'));
    expect(res.status).toBe(403);
    expect(guardClassAccess).not.toHaveBeenCalled();
  });

  it('returns 403 when guardClassAccess rejects', async () => {
    const { NextResponse } = await import('next/server');
    vi.mocked(guardClassAccess).mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const req = new NextRequest('http://localhost/api/teacher/class/c1/roster-signals');
    const res = await GET(req, makeParams('c1'));
    expect(res.status).toBe(403);
  });

  it('returns 200 with roster + concept_gaps on valid access', async () => {
    const req = new NextRequest('http://localhost/api/teacher/class/c1/roster-signals');
    const res = await GET(req, makeParams('c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('roster');
    expect(body).toHaveProperty('concept_gaps');
    expect(body).toHaveProperty('focus_group');
    expect(Array.isArray(body.roster)).toBe(true);
  });

  // C4: diagnose called with DiagnoseInput shape { divergence_score, hw_avg, quiz_avg, error_types }
  it('C4: diagnose is called with DiagnoseInput shape including divergence_score', async () => {
    // Stub enrollments to return one student
    const mockAdmin = makeMockAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockAdmin as any).from = vi.fn((table: string) => {
      if (table === 'enrollments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                data: [
                  {
                    student_id: 'stu1',
                    users: { id: 'stu1', full_name: 'Alice' },
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      // Fallback: empty
      return {
        select: () => ({
          eq: () => ({
            data: [],
            error: null,
            order: () => ({ limit: () => ({ data: [], error: null }) }),
            in: () => ({ data: [], error: null }),
          }),
          in: () => ({ data: [], error: null }),
        }),
      };
    });

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      mockAdmin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const req = new NextRequest('http://localhost/api/teacher/class/c1/roster-signals');
    await GET(req, makeParams('c1'));

    expect(diagnose).toHaveBeenCalled();
    const callArg = vi.mocked(diagnose).mock.calls[0][0];
    // C4: must have divergence_score, hw_avg, quiz_avg, error_types
    expect(callArg).toHaveProperty('divergence_score');
    expect(callArg).toHaveProperty('hw_avg');
    expect(callArg).toHaveProperty('quiz_avg');
    expect(callArg).toHaveProperty('error_types');
    // NOT the old shape
    expect(callArg).not.toHaveProperty('divergencePts');
    expect(callArg).not.toHaveProperty('hwAvg');
    expect(callArg).not.toHaveProperty('avgHints');
  });
});
