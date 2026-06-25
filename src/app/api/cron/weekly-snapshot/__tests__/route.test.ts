// src/app/api/cron/weekly-snapshot/__tests__/route.test.ts
//
// TDD test suite for the weekly-snapshot cron.
// Corrections applied: C3/C6/C11/C12/C15/C22/C23/C24
//
// Key invariants under test:
//   C3  — computeSessionRisk is NOT called
//   C11 — recomputeSkillStatesForStudent uses object signature { studentId, schoolId }
//   C12 — computeRosterRiskIndex receives raw attempt arrays (StudentSignalData shape)
//   C15 — improvement_4w uses exact .eq('snapshot_date', prior_date), not .lte
//   C22 — consistency_score is written to the upsert payload
//   C23 — mastery_band = currentMasteryBand(quizRows), NOT a computeSkillState value
//   C24 — referenceDate injected into computeRosterRiskIndex (no bare clock)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Snapshot payload type (mirrors 0006+0011 columns written by the route) ───

interface SnapshotPayload {
  student_id: string;
  school_id: string | null;
  snapshot_date: string;
  snapshot_schema_version: string;
  mastery_band: string | null;
  learning_style: string | null;
  strength_topics: string[];
  struggle_topics: string[];
  avg_score: number | null;
  total_quizzes: number;
  total_homework: number;
  improvement_4w: number | null;
  consistency_label: string | null;
  consistency_score: number | null;
  risk_score: number;
  divergence_score: number;
  divergence_direction: string;
  dominant_effort_pattern: string | null;
  recent_effort_labels: unknown;
  avg_hints_per_attempt: number | null;
  preferred_scaffold_level: string | null;
}

// ── helpers ────────────────────────────────────────────────────────────────────

const FIXED_REF = new Date('2026-06-18T00:00:00Z'); // Thursday → Monday = 2026-06-15
const EXPECTED_MONDAY = '2026-06-15';
const EXPECTED_PRIOR_DATE = '2026-05-18'; // EXPECTED_MONDAY - 28 days

function makeReq(secret: string, refDate?: string) {
  const url = new URL('http://localhost/api/cron/weekly-snapshot');
  if (refDate) url.searchParams.set('ref_date', refDate);
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
  });
}

// ── mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/skills/recomputeSkillStates', () => ({
  recomputeSkillStatesForStudent: vi.fn().mockResolvedValue({ ok: true, skillsRecomputed: 2, states: {} }),
}));

vi.mock('@/lib/signals/consistency', () => ({
  computeConsistency: vi.fn().mockReturnValue({ consistency_score: 82, consistency_label: 'consistent' }),
  computeTrajectory: vi.fn().mockReturnValue({ trajectory: 'improving' }),
}));

vi.mock('@/lib/signals/computeHwQuizDivergence', () => ({
  computeHwQuizDivergence: vi.fn().mockReturnValue({
    divergence_score: 10,
    divergence_direction: 'aligned',
    divergence_trend: null,
    hw_avg: 78,
    quiz_avg: 75,
  }),
}));

vi.mock('@/lib/signals/computeRosterRiskIndex', () => ({
  computeRosterRiskIndex: vi.fn().mockReturnValue({ risk_score: 40, risk_level: 'medium', risk_factors: [] }),
}));

// C3: computeSessionRisk is NOT imported or called by the cron route.
// We do NOT mock it here — if the route tries to import it, the test would catch
// it via the source-text check below.

vi.mock('@/lib/utils/scoring', () => ({
  currentMasteryBand: vi.fn().mockReturnValue('grade_level'),
  computeMasteryBand: vi.fn().mockReturnValue('grade_level'),
}));

// ── imports after mocks ────────────────────────────────────────────────────────

import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';
import { computeRosterRiskIndex } from '@/lib/signals/computeRosterRiskIndex';
import { currentMasteryBand } from '@/lib/utils/scoring';

// ── mock admin client factory ──────────────────────────────────────────────────

interface MockAdminOpts {
  activeStudents?: { id: string; school_id: string }[];
  skillStates?: { skill: { name: string }; state: string }[];
  quizAttempts?: {
    score_pct: number;
    mastery_band: string | null;
    submitted_at: string;
    is_complete: boolean;
    created_at: string;
  }[];
  homeworkAttempts?: {
    score_pct: number | null;
    teli_hint_count: number | null;
    effort_label: string | null;
    submitted_at: string;
    allow_redo: boolean;
    is_redo: boolean;
  }[];
  priorSnapshot?: { avg_score: number } | null;
  upsertError?: object | null;
}

function makeMockAdmin(opts: MockAdminOpts) {
  const defaultQuizAttempts = [
    { score_pct: 80, mastery_band: 'grade_level', submitted_at: '2026-06-15T10:00:00Z', is_complete: true, created_at: '2026-06-15T10:00:00Z' },
  ];
  const defaultHomeworkAttempts = [
    { score_pct: 75, teli_hint_count: 1, effort_label: 'independent_success', submitted_at: '2026-06-15T10:00:00Z', allow_redo: false, is_redo: false },
  ];

  const from = vi.fn((table: string) => {
    if (table === 'enrollments') {
      const students = opts.activeStudents ?? [{ id: 's1', school_id: 'school1' }];
      const rows = students.map((s) => ({
        student_id: s.id,
        users: { id: s.id, school_id: s.school_id },
        class_id: 'class1',
      }));
      return {
        select: () => ({
          eq: () => ({ data: rows, error: null }),
        }),
      };
    }

    if (table === 'skill_learning_state') {
      const states = opts.skillStates ?? [
        { skill: { name: 'Fractions' }, state: 'ready_to_extend' },
        { skill: { name: 'Algebra' }, state: 'needs_more_time' },
      ];
      return {
        select: () => ({
          eq: () => ({ data: states, error: null }),
        }),
      };
    }

    if (table === 'quiz_attempts') {
      const attempts = opts.quizAttempts ?? defaultQuizAttempts;
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ data: attempts, error: null }),
            }),
          }),
        }),
      };
    }

    if (table === 'homework_attempts') {
      const attempts = opts.homeworkAttempts ?? defaultHomeworkAttempts;
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ data: attempts, error: null }),
            }),
          }),
        }),
      };
    }

    if (table === 'student_model_snapshots') {
      return {
        select: () => ({
          eq: (_col: string, _val: string) => ({
            eq: (_col2: string, _val2: string) => ({
              maybeSingle: async () => ({
                data: opts.priorSnapshot !== undefined ? opts.priorSnapshot : null,
                error: null,
              }),
            }),
            maybeSingle: async () => ({
              data: opts.priorSnapshot !== undefined ? opts.priorSnapshot : null,
              error: null,
            }),
          }),
        }),
        upsert: async (_payload: unknown, _upsertOpts?: unknown) => ({
          data: null,
          error: opts.upsertError ?? null,
        }),
      };
    }

    if (table === 'skill_state_snapshots') {
      return { upsert: async () => ({ data: null, error: null }) };
    }

    return { data: [], error: null };
  });

  return { from };
}

// Helper to wrap admin with a upsert payload capture
function withCapturedUpsert(
  opts: MockAdminOpts,
  onUpsert: (payload: SnapshotPayload) => void,
) {
  const base = makeMockAdmin(opts);
  const origFrom = base.from.bind(base);
  base.from = vi.fn((table: string) => {
    const chain = origFrom(table);
    if (table === 'student_model_snapshots') {
      return {
        ...(chain as object),
        upsert: async (payload: SnapshotPayload, _upsertOpts?: unknown) => {
          onUpsert(payload);
          return { data: null, error: opts.upsertError ?? null };
        },
      };
    }
    return chain;
  }) as unknown as typeof base.from;
  return base;
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/cron/weekly-snapshot', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-service-key');
    const admin = makeMockAdmin({});
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    vi.clearAllMocks();
    vi.mocked(recomputeSkillStatesForStudent).mockResolvedValue({
      ok: true,
      skillsRecomputed: 2,
      states: {},
    });
    vi.mocked(computeRosterRiskIndex).mockReturnValue({
      risk_score: 40,
      risk_level: 'medium',
      risk_factors: [],
    });
    vi.mocked(currentMasteryBand).mockReturnValue('grade_level');
  });

  // ── CRON_SECRET gate ─────────────────────────────────────────────────────────

  it('returns 401 when x-cron-secret header is missing', async () => {
    const admin = makeMockAdmin({});
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    const req = new NextRequest('http://localhost/api/cron/weekly-snapshot', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when x-cron-secret header does not match', async () => {
    const admin = makeMockAdmin({});
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    const res = await POST(makeReq('wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 200 with summary on valid secret', async () => {
    const admin = makeMockAdmin({});
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    const res = await POST(makeReq('test-secret', '2026-06-18'));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ snapshot_date: expect.any(String), processed: expect.any(Number) });
  });

  // ── isoWeekMonday helper ──────────────────────────────────────────────────────

  it('isoWeekMonday(2026-06-18) returns 2026-06-15 (Thursday → Monday)', async () => {
    const { isoWeekMonday } = await import('../route');
    expect(isoWeekMonday(FIXED_REF)).toBe(EXPECTED_MONDAY);
  });

  it('isoWeekMonday is idempotent — calling with Monday returns same Monday', async () => {
    const { isoWeekMonday } = await import('../route');
    const monday = new Date('2026-06-15T00:00:00Z');
    expect(isoWeekMonday(monday)).toBe('2026-06-15');
  });

  it('snapshot_date in response is the ISO-week Monday for ref_date', async () => {
    const admin = makeMockAdmin({});
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    const res = await POST(makeReq('test-secret', '2026-06-18'));
    const body = await res.json() as Record<string, unknown>;
    expect(body.snapshot_date).toBe(EXPECTED_MONDAY);
  });

  // ── Ordering: recompute BEFORE rollup (C11) ────────────────────────────────────

  it('recomputeSkillStatesForStudent is called before skill_learning_state rollup', async () => {
    const callOrder: string[] = [];
    vi.mocked(recomputeSkillStatesForStudent).mockImplementation(async () => {
      callOrder.push('recompute');
      return { ok: true, skillsRecomputed: 2, states: {} };
    });

    const base = makeMockAdmin({});
    const origFrom = base.from.bind(base);
    base.from = vi.fn((table: string) => {
      if (table === 'skill_learning_state') {
        callOrder.push('skill_learning_state_read');
      }
      return origFrom(table);
    }) as unknown as typeof base.from;

    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      base as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));

    const recomputeIdx = callOrder.indexOf('recompute');
    const rollupIdx = callOrder.indexOf('skill_learning_state_read');
    expect(recomputeIdx).toBeGreaterThanOrEqual(0);
    expect(rollupIdx).toBeGreaterThanOrEqual(0);
    expect(recomputeIdx).toBeLessThan(rollupIdx);
  });

  // ── C11: object signature for recomputeSkillStatesForStudent ─────────────────

  it('recomputeSkillStatesForStudent is called with object signature { studentId, schoolId }', async () => {
    const admin = makeMockAdmin({});
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    expect(recomputeSkillStatesForStudent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ studentId: expect.any(String), schoolId: expect.any(String) }),
    );
  });

  // ── C12: computeRosterRiskIndex gets raw attempt arrays ──────────────────────

  it('computeRosterRiskIndex is called with StudentSignalData shape (raw attempts) and referenceDate', async () => {
    const admin = makeMockAdmin({});
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    expect(computeRosterRiskIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        homeworkAttempts: expect.any(Array),
        quizAttempts: expect.any(Array),
        totalAssigned: expect.any(Number),
      }),
      expect.any(Date), // C24: injected referenceDate
    );
  });

  // ── C15: improvement_4w exact 28-day .eq lookup ────────────────────────────────

  it('improvement_4w is null when no prior snapshot exists at date-28d', async () => {
    let capturedPayload: SnapshotPayload | null = null;
    const admin = withCapturedUpsert({ priorSnapshot: null }, (p) => { capturedPayload = p; });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    const cp1 = capturedPayload as SnapshotPayload | null;
    expect(cp1?.improvement_4w).toBeNull();
  });

  it('improvement_4w is not null when prior snapshot exists', async () => {
    let capturedPayload: SnapshotPayload | null = null;
    const admin = withCapturedUpsert({ priorSnapshot: { avg_score: 70 } }, (p) => { capturedPayload = p; });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    // avg_score from default quiz attempts is 80; prior was 70 → improvement = 10
    const cp2 = capturedPayload as SnapshotPayload | null;
    expect(cp2?.improvement_4w).not.toBeNull();
  });

  it('improvement_4w lookup uses exact .eq on snapshot_date (not .lte)', async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const base = makeMockAdmin({ priorSnapshot: null });
    const origFrom = base.from.bind(base);
    base.from = vi.fn((table: string) => {
      if (table === 'student_model_snapshots') {
        return {
          select: () => ({
            eq: (col: string, val: unknown) => {
              eqCalls.push([col, val]);
              return {
                eq: (_col2: string, _val2: unknown) => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
                maybeSingle: async () => ({ data: null, error: null }),
              };
            },
          }),
          upsert: async () => ({ data: null, error: null }),
        };
      }
      return origFrom(table);
    }) as unknown as typeof base.from;
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      base as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    // Must have called .eq('snapshot_date', EXPECTED_PRIOR_DATE)
    const snapshotDateCall = eqCalls.find(([col]) => col === 'snapshot_date');
    expect(snapshotDateCall).toBeDefined();
    expect(snapshotDateCall?.[1]).toBe(EXPECTED_PRIOR_DATE);
  });

  // ── C22: consistency_score is written ────────────────────────────────────────

  it('upsert payload contains consistency_score (C22)', async () => {
    let capturedPayload: SnapshotPayload | null = null;
    const admin = withCapturedUpsert({}, (p) => { capturedPayload = p; });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    // consistency_score must be present (even if null for cold-start)
    expect('consistency_score' in (capturedPayload ?? {})).toBe(true);
  });

  // ── C23: mastery_band = currentMasteryBand(quizRows) ─────────────────────────

  it('mastery_band in upsert comes from currentMasteryBand, not computeSkillState (C23)', async () => {
    vi.mocked(currentMasteryBand).mockReturnValue('advanced');
    let capturedPayload: SnapshotPayload | null = null;
    const admin = withCapturedUpsert({
      quizAttempts: [
        { score_pct: 90, mastery_band: 'advanced', submitted_at: '2026-06-15T10:00:00Z', is_complete: true, created_at: '2026-06-15T10:00:00Z' },
      ],
    }, (p) => { capturedPayload = p; });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    const cpM = capturedPayload as SnapshotPayload | null;
    // mastery_band must equal what currentMasteryBand returned ('advanced')
    expect(cpM?.mastery_band).toBe('advanced');
    // currentMasteryBand must have been called with the quiz rows
    expect(currentMasteryBand).toHaveBeenCalled();
  });

  // ── snapshot_schema_version ─────────────────────────────────────────────────

  it('snapshot_schema_version is v2', async () => {
    let capturedPayload: SnapshotPayload | null = null;
    const admin = withCapturedUpsert({}, (p) => { capturedPayload = p; });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    const cpV = capturedPayload as SnapshotPayload | null;
    expect(cpV?.snapshot_schema_version).toBe('v2');
  });

  // ── divergence columns ───────────────────────────────────────────────────────

  it('upsert payload contains divergence_score and divergence_direction', async () => {
    let capturedPayload: SnapshotPayload | null = null;
    const admin = withCapturedUpsert({}, (p) => { capturedPayload = p; });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    const cpD = capturedPayload as SnapshotPayload | null;
    expect(cpD?.divergence_score).toBeDefined();
    expect(cpD?.divergence_direction).toBeDefined();
  });

  // ── risk_score (C3 + C24) ────────────────────────────────────────────────────

  it('risk_score in upsert equals computeRosterRiskIndex result (C3 — no session risk)', async () => {
    vi.mocked(computeRosterRiskIndex).mockReturnValue({ risk_score: 55, risk_level: 'high', risk_factors: [] });
    let capturedPayload: SnapshotPayload | null = null;
    const admin = withCapturedUpsert({}, (p) => { capturedPayload = p; });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    const cpR = capturedPayload as SnapshotPayload | null;
    expect(cpR?.risk_score).toBe(55);
  });

  // ── C3: computeSessionRisk NOT called ────────────────────────────────────────

  it('does not import or call computeSessionRisk (C3 — session risk is per-attempt, not cron)', async () => {
    // Strip comments from route source, then verify no computeSessionRisk reference
    const routeText = (await import('node:fs')).readFileSync(
      new URL('../route.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      'utf-8',
    );
    const noComments = routeText
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/\/\/[^\n]*/g, '');         // line comments
    expect(noComments).not.toMatch(/computeSessionRisk/);
  });

  // ── Per-student failure isolation ────────────────────────────────────────────

  it('per-student failure is isolated — other students are still processed', async () => {
    let callCount = 0;
    vi.mocked(recomputeSkillStatesForStudent).mockImplementation(async (_admin, args) => {
      callCount++;
      const argObj = args as { studentId?: string };
      if (argObj.studentId === 's1') throw new Error('simulated recompute failure');
      return { ok: true, skillsRecomputed: 2, states: {} };
    });
    const admin = makeMockAdmin({
      activeStudents: [
        { id: 's1', school_id: 'school1' },
        { id: 's2', school_id: 'school1' },
      ],
    });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    const res = await POST(makeReq('test-secret', '2026-06-18'));
    expect(res.status).toBe(200);
    const body = await res.json() as { failed: number; processed: number };
    expect(body.failed).toBeGreaterThanOrEqual(1);
    expect(body.processed + body.failed).toBe(2);
    expect(callCount).toBe(2); // both students attempted
  });

  // ── strength/struggle topic rollup ───────────────────────────────────────────

  it('rolls up strength_topics and struggle_topics from skill_learning_state', async () => {
    let capturedPayload: SnapshotPayload | null = null;
    const admin = withCapturedUpsert({
      skillStates: [
        { skill: { name: 'Fractions' }, state: 'ready_to_extend' },
        { skill: { name: 'Geometry' }, state: 'on_track' },
        { skill: { name: 'Algebra' }, state: 'needs_more_time' },
        { skill: { name: 'Decimals' }, state: 'needs_different_instruction' },
      ],
    }, (p) => { capturedPayload = p; });
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminSupabaseClient>,
    );
    const { POST } = await import('../route');
    await POST(makeReq('test-secret', '2026-06-18'));
    const cpT = capturedPayload as SnapshotPayload | null;
    expect(cpT?.strength_topics).toContain('Fractions');
    expect(cpT?.strength_topics).toContain('Geometry');
    expect(cpT?.struggle_topics).toContain('Algebra');
    expect(cpT?.struggle_topics).toContain('Decimals');
  });
});
