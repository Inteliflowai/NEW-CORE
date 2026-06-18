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
import { computeHwQuizDivergence } from '@/lib/signals/computeHwQuizDivergence';

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

/** Admin mock that returns one enrolled student with given quiz/hw scores. */
function makeMockAdminWithStudent(
  studentId: string,
  quizScores: number[],
  hwScores: number[],
) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'enrollments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                data: [{ student_id: studentId, users: { id: studentId, full_name: 'Test Student' } }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'quiz_attempts') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  data: quizScores.map((s) => ({
                    id: `qa-${s}`,
                    mastery_band: 'grade_level',
                    submitted_at: '2026-06-15T10:00:00Z',
                    created_at: '2026-06-15T10:00:00Z',
                    is_complete: true,
                    score_pct: s,
                  })),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'homework_attempts') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  data: hwScores.map((s) => ({
                    id: `hw-${s}`,
                    score_pct: s,
                    teli_hint_count: 0,
                    submitted_at: '2026-06-15T10:00:00Z',
                    allow_redo: false,
                    is_redo: false,
                  })),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'misconception_observations') {
        return {
          select: () => ({
            in: () => ({ data: [], error: null }),
          }),
        };
      }
      // Fallback
      const chainBase = (): object => ({
        data: [],
        error: null,
        order: () => ({ limit: () => ({ data: [], error: null }) }),
        in: () => ({ data: [], error: null }),
        eq: () => chainBase(),
      });
      return {
        select: () => ({
          eq: () => chainBase(),
          in: () => ({ data: [], error: null }),
        }),
      };
    }),
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

  // ── FIX 1 (a2): gap-22 student appears in focus_group as low-severity monitor ──

  it('FIX1: gap-22 student surfaces in focus_group at low severity (monitor tier)', async () => {
    // Mock computeHwQuizDivergence to return score=22
    vi.mocked(computeHwQuizDivergence).mockReturnValueOnce({
      divergence_score: 22,
      divergence_direction: 'hw_higher',
      divergence_trend: null,
      hw_avg: 82,
      quiz_avg: 60,
    });
    // Mock diagnose to return a monitor-tier result (as if the real diagnose() with gap 20-24 fires)
    vi.mocked(diagnose).mockReturnValueOnce({
      suggestedAction: 'monitor',
      severity: 1,
      diagnosis: 'HW/quiz gap of 22 pts — worth monitoring',
    });

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdminWithStudent('stu-gap22', [60], [82]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const req = new NextRequest('http://localhost/api/teacher/class/c1/roster-signals');
    const res = await GET(req, makeParams('c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Student must appear in focus_group
    const inFocus = body.focus_group.some((f: { student_id: string }) => f.student_id === 'stu-gap22');
    expect(inFocus).toBe(true);
    // Must be low severity
    const focusEntry = body.focus_group.find((f: { student_id: string }) => f.student_id === 'stu-gap22');
    expect(focusEntry.diagnosis.severity).toBe(1);
    expect(focusEntry.diagnosis.suggestedAction).toBe('monitor');
  });

  it('FIX1: gap-27 student gets escalation (existing sev-1+ profile path), not monitor', async () => {
    vi.mocked(computeHwQuizDivergence).mockReturnValueOnce({
      divergence_score: 27,
      divergence_direction: 'hw_higher',
      divergence_trend: null,
      hw_avg: 87,
      quiz_avg: 60,
    });
    vi.mocked(diagnose).mockReturnValueOnce({
      suggestedAction: 'profile',
      severity: 1,
      diagnosis: 'Divergence score 27 — check student profile for context.',
    });

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdminWithStudent('stu-gap27', [60], [87]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const req = new NextRequest('http://localhost/api/teacher/class/c1/roster-signals');
    const res = await GET(req, makeParams('c1'));
    const body = await res.json();
    const focusEntry = body.focus_group.find((f: { student_id: string }) => f.student_id === 'stu-gap27');
    expect(focusEntry).toBeDefined();
    expect(focusEntry.diagnosis.suggestedAction).toBe('profile');
    expect(focusEntry.diagnosis.suggestedAction).not.toBe('monitor');
  });

  it('FIX1: gap-10 student does NOT appear in focus_group', async () => {
    vi.mocked(computeHwQuizDivergence).mockReturnValueOnce({
      divergence_score: 10,
      divergence_direction: 'aligned',
      divergence_trend: null,
      hw_avg: 75,
      quiz_avg: 65,
    });
    vi.mocked(diagnose).mockReturnValueOnce(null);

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      makeMockAdminWithStudent('stu-gap10', [65], [75]) as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );

    const req = new NextRequest('http://localhost/api/teacher/class/c1/roster-signals');
    const res = await GET(req, makeParams('c1'));
    const body = await res.json();
    const inFocus = body.focus_group.some((f: { student_id: string }) => f.student_id === 'stu-gap10');
    expect(inFocus).toBe(false);
  });
});
