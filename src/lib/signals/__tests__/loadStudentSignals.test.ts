import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks for the underlying pure signal modules ─────────────────────────────
vi.mock('@/lib/utils/scoring', () => ({
  currentMasteryBand: vi.fn().mockReturnValue('grade_level'),
}));
vi.mock('@/lib/signals/computeHwQuizDivergence', () => ({
  computeHwQuizDivergence: vi.fn().mockReturnValue({
    divergence_score: 22,
    divergence_direction: 'hw_higher',
    divergence_trend: null,
    hw_avg: 80,
    quiz_avg: 58,
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
}));
vi.mock('@/lib/signals/computeReteachEffectiveness', () => ({
  detectCompletedReteachCycles: vi.fn().mockReturnValue([]),
}));
vi.mock('@/lib/signals/consistency', () => ({
  computeConsistency: vi.fn().mockReturnValue({
    consistency_score: 80,
    consistency_label: 'consistent',
  }),
  computeTrajectory: vi.fn().mockReturnValue({ trajectory: 'improving' }),
}));

import { loadStudentSignals, confidenceSoftLabel } from '../loadStudentSignals';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Mock admin client: per-table data injection ──────────────────────────────
function makeAdmin(tableData: Record<string, unknown[]>) {
  const chainFor = (table: string) => {
    const rows = tableData[table] ?? [];
    const result = { data: rows, error: null };
    const chain = {
      ...result,
      order: () => ({ limit: () => result, ...result }),
      limit: () => result,
      eq: () => chain,
      in: () => result,
      single: async () => ({ data: rows[0] ?? null, error: null }),
    };
    return chain;
  };
  return {
    from: vi.fn((table: string) => ({
      select: () => chainFor(table),
    })),
  } as unknown as SupabaseClient;
}

describe('confidenceSoftLabel', () => {
  it('maps numeric confidence to soft words, never a number', () => {
    expect(confidenceSoftLabel(null)).toBe('unknown');
    expect(confidenceSoftLabel(80)).toBe('consistent');
    expect(confidenceSoftLabel(50)).toBe('tentative');
    expect(confidenceSoftLabel(10)).toBe('emerging');
  });
});

describe('loadStudentSignals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the full typed bundle with student_id echoed', async () => {
    const admin = makeAdmin({});
    const out = await loadStudentSignals(admin, 'stu-1');
    expect(out.student_id).toBe('stu-1');
    expect(out).toHaveProperty('current_band');
    expect(out).toHaveProperty('per_skill_cl');
    expect(out).toHaveProperty('recurring_misconceptions');
    expect(out).toHaveProperty('divergence');
    expect(out).toHaveProperty('effort');
    expect(out).toHaveProperty('risk');
    expect(out).toHaveProperty('reteach_outcomes');
    expect(out).toHaveProperty('trajectory');
  });

  it('includes growth_history derived from snapshot avg_score (oldest→newest, nulls filtered)', async () => {
    const admin = makeAdmin({
      student_model_snapshots: [
        { snapshot_date: '2026-01-01', avg_score: 40 },
        { snapshot_date: '2026-02-01', avg_score: null },
        { snapshot_date: '2026-03-01', avg_score: 58 },
      ],
    });
    const out = await loadStudentSignals(admin, 'stu-1');
    expect(out.growth_history).toEqual([40, 58]);
  });

  it('sets divergence_flagged=true when divergence_score >= 20', async () => {
    const admin = makeAdmin({});
    const out = await loadStudentSignals(admin, 'stu-1');
    expect(out.divergence.divergence_flagged).toBe(true);
  });

  it('maps per_skill_cl confidence to a soft word (never a raw number)', async () => {
    const admin = makeAdmin({
      skill_learning_state: [
        { skill: { id: 'sk1', name: 'Fractions' }, state: 'on_track', confidence: 90 },
      ],
    });
    const out = await loadStudentSignals(admin, 'stu-1');
    expect(out.per_skill_cl[0].cl_verb).toBe('On Track');
    expect(out.per_skill_cl[0].confidence_label).toBe('consistent');
    expect(out.per_skill_cl[0].confidence_label).not.toMatch(/\d/);
  });
});
