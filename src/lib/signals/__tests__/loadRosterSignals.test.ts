// Node env — no jsdom header needed
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/utils/scoring', () => ({
  currentMasteryBand: vi.fn().mockReturnValue('grade_level'),
  bandIsVolatile: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/signals/computeRosterRiskIndex', () => ({
  computeRosterRiskIndex: vi.fn().mockReturnValue({
    risk_score: 20,
    risk_level: 'low',
    risk_factors: [],
  }),
}));

vi.mock('@/lib/signals/computeHwQuizDivergence', () => ({
  computeHwQuizDivergence: vi.fn().mockReturnValue({
    divergence_score: 5,
    divergence_direction: 'aligned',
    divergence_trend: null,
    hw_avg: 80,
    quiz_avg: 78,
  }),
}));

// Partial mock: keep the REAL findRecurringError + RECURRING_ERROR_THRESHOLD (loadRosterSignals
// now uses findRecurringError for per-skill recurrence); only diagnose is stubbed by default.
vi.mock('@/lib/signals/diagnosis', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/signals/diagnosis')>();
  return { ...actual, diagnose: vi.fn().mockReturnValue(null) };
});

vi.mock('@/lib/signals/conceptGapDetector', () => ({
  detectConceptGaps: vi.fn().mockReturnValue([]),
}));

// ── Lazy imports ──────────────────────────────────────────────────────────────
import { loadRosterSignals } from '../loadRosterSignals';
import { detectConceptGaps } from '@/lib/signals/conceptGapDetector';
import { diagnose } from '@/lib/signals/diagnosis';

// ── Mock admin builders ───────────────────────────────────────────────────────

/**
 * Builds a minimal mock admin client that:
 *  - enrollments → one student (stu1, 'Alice')
 *  - quiz_attempts → [{ score_pct: 75, mastery_band: 'grade_level', ... }]
 *  - homework_attempts → [{ score_pct: 80, ... }]
 *  - misconception_observations → one row with skill_id: 'sk1', repeated 5 times
 *    (5 rows so detectConceptGaps — if real — would flag it; but we mock that)
 *  - skills → [{ id: 'sk1', name: 'Adding fractions' }]
 */
function makeMockAdmin(
  skillRows: { id: string; name: string }[] = [{ id: 'sk1', name: 'Adding fractions' }],
  misconceptionRows: { student_id: string; skill_id: string; error_type: string }[] =
    Array(5).fill({ student_id: 'stu1', skill_id: 'sk1', error_type: 'wrong_op' }),
) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'enrollments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                data: [{ student_id: 'stu1', users: { id: 'stu1', full_name: 'Alice' } }],
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
                  data: [
                    {
                      mastery_band: 'grade_level',
                      submitted_at: '2026-06-15T10:00:00Z',
                      created_at: '2026-06-15T10:00:00Z',
                      is_complete: true,
                      score_pct: 75,
                    },
                  ],
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
                  data: [
                    {
                      score_pct: 80,
                      teli_hint_count: 0,
                      submitted_at: '2026-06-15T10:00:00Z',
                      allow_redo: false,
                      is_redo: false,
                    },
                  ],
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
            in: () => ({
              data: misconceptionRows,
              error: null,
            }),
          }),
        };
      }
      if (table === 'skills') {
        return {
          select: () => ({
            in: () => ({ data: skillRows, error: null }),
          }),
        };
      }
      // Fallback
      return {
        select: () => ({
          eq: () => ({ data: [], error: null }),
          in: () => ({ data: [], error: null }),
        }),
      };
    }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadRosterSignals()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset detectConceptGaps to return empty by default
    vi.mocked(detectConceptGaps).mockReturnValue([]);
    // clearAllMocks does NOT reset implementations — re-establish diagnose's default so the
    // e2e tests' mockImplementation(actual.diagnose) can't leak into later tests via ordering.
    vi.mocked(diagnose).mockReturnValue(null);
  });

  it('returns an object with class_id, roster, focus_group, concept_gaps', async () => {
    const admin = makeMockAdmin() as unknown as Parameters<typeof loadRosterSignals>[0];
    const result = await loadRosterSignals(admin, 'class-abc');

    expect(result).toHaveProperty('class_id', 'class-abc');
    expect(result).toHaveProperty('roster');
    expect(result).toHaveProperty('focus_group');
    expect(result).toHaveProperty('concept_gaps');
  });

  it('roster[0] has student_id, full_name, band, volatile, risk', async () => {
    const admin = makeMockAdmin() as unknown as Parameters<typeof loadRosterSignals>[0];
    const result = await loadRosterSignals(admin, 'class-abc');

    expect(result.roster).toHaveLength(1);
    const stu = result.roster[0];
    expect(stu.student_id).toBe('stu1');
    expect(stu.full_name).toBe('Alice');
    expect(stu.band).toBe('grade_level');
    expect(stu.volatile).toBe(false);
    expect(stu.risk).toMatchObject({ risk_score: 20, risk_level: 'low' });
  });

  it('concept_gaps items carry skill_name from the skills JOIN', async () => {
    // Make detectConceptGaps return one gap with question_text = 'sk1'
    vi.mocked(detectConceptGaps).mockReturnValue([
      { question_index: 0, question_text: 'sk1', pct_incorrect: 60 },
    ]);

    const admin = makeMockAdmin([{ id: 'sk1', name: 'Adding fractions' }]) as unknown as Parameters<typeof loadRosterSignals>[0];
    const result = await loadRosterSignals(admin, 'class-abc');

    expect(result.concept_gaps).toHaveLength(1);
    const gap = result.concept_gaps[0];
    expect(gap.question_index).toBe(0);
    expect(gap.question_text).toBe('sk1');          // opaque id kept
    expect(gap.skill_name).toBe('Adding fractions'); // resolved name
    expect(gap.pct_incorrect).toBe(60);
  });

  it('skill_name is null when skills table has no matching row', async () => {
    vi.mocked(detectConceptGaps).mockReturnValue([
      { question_index: 0, question_text: 'sk-unknown', pct_incorrect: 55 },
    ]);

    // skills table returns empty (no match)
    const admin = makeMockAdmin([]) as unknown as Parameters<typeof loadRosterSignals>[0];
    const result = await loadRosterSignals(admin, 'class-abc');

    expect(result.concept_gaps).toHaveLength(1);
    expect(result.concept_gaps[0].skill_name).toBeNull();
    expect(result.concept_gaps[0].question_text).toBe('sk-unknown'); // still kept
  });

  it('skills query is skipped when concept_gaps is empty', async () => {
    vi.mocked(detectConceptGaps).mockReturnValue([]);

    const admin = makeMockAdmin() as unknown as Parameters<typeof loadRosterSignals>[0];
    const result = await loadRosterSignals(admin, 'class-abc');

    expect(result.concept_gaps).toHaveLength(0);
    // skills table should not have been called
    const skillsCalls = (admin.from as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0] === 'skills',
    );
    expect(skillsCalls).toHaveLength(0);
  });

  it('focus_group contains students with non-null diagnosis', async () => {
    const { diagnose: diagnoseFn } = await import('@/lib/signals/diagnosis');
    vi.mocked(diagnoseFn).mockReturnValueOnce({
      suggestedAction: 'monitor',
      severity: 1,
      diagnosis: 'Small gap',
    });

    const admin = makeMockAdmin() as unknown as Parameters<typeof loadRosterSignals>[0];
    const result = await loadRosterSignals(admin, 'class-abc');

    expect(result.focus_group).toHaveLength(1);
    expect(result.focus_group[0].student_id).toBe('stu1');
    expect(result.focus_group[0].diagnosis.suggestedAction).toBe('monitor');
  });

  it('threads each student\'s misconception error_types into diagnose() (was hardcoded [])', async () => {
    const admin = makeMockAdmin() as unknown as Parameters<typeof loadRosterSignals>[0];
    await loadRosterSignals(admin, 'class-1');
    const calls = vi.mocked(diagnose).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const stuCall = calls.find((c) => (c[0].error_types?.length ?? 0) > 0);
    expect(stuCall).toBeDefined();
    expect(stuCall![0].error_types).toContain('wrong_op');
  });

  // End-to-end through the REAL diagnose + findRecurringError (no homework → only the
  // recurring-error branch is reachable): proves the headline "lights up from quizzes" path.
  it('lights up focus_group: >=3 same-error_type on ONE skill yields a practice diagnosis', async () => {
    const actual = await vi.importActual<typeof import('@/lib/signals/diagnosis')>('@/lib/signals/diagnosis');
    vi.mocked(diagnose).mockImplementation(actual.diagnose);
    // 3 identical errors on a SINGLE skill (RECURRING_ERROR_THRESHOLD = 3).
    const rows = Array(3).fill({ student_id: 'stu1', skill_id: 'sk1', error_type: 'wrong_op' });
    const admin = makeMockAdmin(undefined, rows) as unknown as Parameters<typeof loadRosterSignals>[0];
    const result = await loadRosterSignals(admin, 'class-1');
    const inGroup = result.focus_group.find((f) => f.student_id === 'stu1');
    expect(inGroup).toBeDefined();
    expect(inGroup!.diagnosis.suggestedAction).toBe('practice');
  });

  it('feeds diagnose only the RECURRING skill\'s error_types, not a below-threshold skill\'s', async () => {
    // sk1 recurs (3x errA); sk2 is a one-off (errB). recurringErrorTypesFor must select sk1 only.
    // Under the OLD cross-skill flatten, errB would have been included — this locks the per-skill grain.
    const rows = [
      { student_id: 'stu1', skill_id: 'sk1', error_type: 'errA' },
      { student_id: 'stu1', skill_id: 'sk1', error_type: 'errA' },
      { student_id: 'stu1', skill_id: 'sk1', error_type: 'errA' },
      { student_id: 'stu1', skill_id: 'sk2', error_type: 'errB' },
    ];
    const admin = makeMockAdmin(undefined, rows) as unknown as Parameters<typeof loadRosterSignals>[0];
    await loadRosterSignals(admin, 'class-1');
    const call = vi.mocked(diagnose).mock.calls.find((c) => (c[0].error_types?.length ?? 0) > 0);
    expect(call).toBeDefined();
    expect(call![0].error_types).toContain('errA');
    expect(call![0].error_types).not.toContain('errB');
  });

  it('does NOT light up: the SAME error_type once across 3 DIFFERENT skills stays out of focus_group', async () => {
    const actual = await vi.importActual<typeof import('@/lib/signals/diagnosis')>('@/lib/signals/diagnosis');
    vi.mocked(diagnose).mockImplementation(actual.diagnose);
    // Three one-off 'wrong_op' errors, each on a DIFFERENT skill — no single skill recurs.
    const rows = [
      { student_id: 'stu1', skill_id: 'sk1', error_type: 'wrong_op' },
      { student_id: 'stu1', skill_id: 'sk2', error_type: 'wrong_op' },
      { student_id: 'stu1', skill_id: 'sk3', error_type: 'wrong_op' },
    ];
    const admin = makeMockAdmin(undefined, rows) as unknown as Parameters<typeof loadRosterSignals>[0];
    const result = await loadRosterSignals(admin, 'class-1');
    expect(result.focus_group.find((f) => f.student_id === 'stu1')).toBeUndefined();
  });
});
