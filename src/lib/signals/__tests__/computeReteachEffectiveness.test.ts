// src/lib/signals/__tests__/computeReteachEffectiveness.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectCompletedReteachCycles,
  aggregateReteachStats,
  type HomeworkAttemptRow,
  type ReteachCycleRecord,
} from '../computeReteachEffectiveness';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let idCounter = 0;
function makeAttempt(overrides: Partial<HomeworkAttemptRow> = {}): HomeworkAttemptRow {
  idCounter++;
  return {
    id: `attempt-${idCounter}`,
    student_id: 'student-1',
    assignment_id: 'assignment-1',
    score: 80,
    allow_redo: false,
    is_redo: false,
    flagged_by: null,
    submitted_at: new Date(Date.now() - idCounter * 1000).toISOString(),
    created_at: new Date(Date.now() - idCounter * 1000).toISOString(),
    ...overrides,
  };
}

// ─── detectCompletedReteachCycles ────────────────────────────────────────────

describe('detectCompletedReteachCycles', () => {
  beforeEach(() => { idCounter = 0; });

  it('returns empty array when no attempts', () => {
    const result = detectCompletedReteachCycles([], new Set());
    expect(result).toEqual([]);
  });

  it('returns empty when no allow_redo attempts', () => {
    const attempts = [
      makeAttempt({ score: 70, allow_redo: false }),
      makeAttempt({ score: 80, allow_redo: false }),
    ];
    const result = detectCompletedReteachCycles(attempts, new Set());
    expect(result).toEqual([]);
  });

  it('returns empty when allow_redo attempt has no subsequent scored attempt', () => {
    const original = makeAttempt({
      id: 'orig-1',
      score: 60,
      allow_redo: true,
      created_at: new Date(1000).toISOString(),
      submitted_at: new Date(1000).toISOString(),
    });
    const result = detectCompletedReteachCycles([original], new Set());
    expect(result).toEqual([]);
  });

  it('detects a completed reteach cycle with improvement', () => {
    const original = makeAttempt({
      id: 'orig-1',
      score: 55,
      allow_redo: true,
      flagged_by: 'teacher',
      created_at: new Date(1000).toISOString(),
      submitted_at: new Date(1000).toISOString(),
    });
    const redo = makeAttempt({
      id: 'redo-1',
      score: 80,
      allow_redo: false,
      is_redo: true,
      created_at: new Date(2000).toISOString(),
      submitted_at: new Date(2000).toISOString(),
    });

    const result = detectCompletedReteachCycles([original, redo], new Set());

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      student_id: 'student-1',
      assignment_id: 'assignment-1',
      original_attempt_id: 'orig-1',
      redo_attempt_id: 'redo-1',
      pre_score: 55,
      post_score: 80,
      improvement: 25,
      flagged_by: 'teacher',
    });
  });

  it('records negative improvement when redo is worse', () => {
    const original = makeAttempt({
      id: 'orig-2',
      score: 75,
      allow_redo: true,
      flagged_by: 'auto',
      created_at: new Date(1000).toISOString(),
      submitted_at: new Date(1000).toISOString(),
    });
    const redo = makeAttempt({
      id: 'redo-2',
      score: 60,
      is_redo: true,
      created_at: new Date(2000).toISOString(),
      submitted_at: new Date(2000).toISOString(),
    });

    const result = detectCompletedReteachCycles([original, redo], new Set());
    expect(result[0].improvement).toBe(-15);
    expect(result[0].flagged_by).toBe('auto');
  });

  it('deduplicates when pairKey already exists in existingCyclePairs', () => {
    const original = makeAttempt({
      id: 'orig-3',
      score: 50,
      allow_redo: true,
      created_at: new Date(1000).toISOString(),
      submitted_at: new Date(1000).toISOString(),
    });
    const redo = makeAttempt({
      id: 'redo-3',
      score: 75,
      is_redo: true,
      created_at: new Date(2000).toISOString(),
      submitted_at: new Date(2000).toISOString(),
    });

    const existing = new Set(['orig-3:redo-3']);
    const result = detectCompletedReteachCycles([original, redo], existing);
    expect(result).toHaveLength(0);
  });

  it('handles multiple assignments independently', () => {
    const a1orig = makeAttempt({
      id: 'a1-orig',
      assignment_id: 'assignment-A',
      score: 50,
      allow_redo: true,
      created_at: new Date(1000).toISOString(),
      submitted_at: new Date(1000).toISOString(),
    });
    const a1redo = makeAttempt({
      id: 'a1-redo',
      assignment_id: 'assignment-A',
      score: 80,
      is_redo: true,
      created_at: new Date(2000).toISOString(),
      submitted_at: new Date(2000).toISOString(),
    });
    const a2orig = makeAttempt({
      id: 'a2-orig',
      assignment_id: 'assignment-B',
      score: 40,
      allow_redo: true,
      created_at: new Date(3000).toISOString(),
      submitted_at: new Date(3000).toISOString(),
    });
    const a2redo = makeAttempt({
      id: 'a2-redo',
      assignment_id: 'assignment-B',
      score: 70,
      is_redo: true,
      created_at: new Date(4000).toISOString(),
      submitted_at: new Date(4000).toISOString(),
    });

    const result = detectCompletedReteachCycles(
      [a1orig, a1redo, a2orig, a2redo],
      new Set()
    );
    expect(result).toHaveLength(2);
    const assignmentIds = result.map((r) => r.assignment_id).sort();
    expect(assignmentIds).toEqual(['assignment-A', 'assignment-B']);
  });

  it('uses "teacher" as default flagged_by when original.flagged_by is null', () => {
    const original = makeAttempt({
      id: 'orig-null',
      score: 55,
      allow_redo: true,
      flagged_by: null,
      created_at: new Date(1000).toISOString(),
      submitted_at: new Date(1000).toISOString(),
    });
    const redo = makeAttempt({
      id: 'redo-null',
      score: 75,
      is_redo: true,
      created_at: new Date(2000).toISOString(),
      submitted_at: new Date(2000).toISOString(),
    });

    const result = detectCompletedReteachCycles([original, redo], new Set());
    expect(result[0].flagged_by).toBe('teacher');
  });

  it('accepts any later graded attempt as redo even when is_redo=false', () => {
    // The V1 logic uses (a.is_redo || true) — any later scored attempt qualifies
    const original = makeAttempt({
      id: 'orig-any',
      score: 60,
      allow_redo: true,
      created_at: new Date(1000).toISOString(),
      submitted_at: new Date(1000).toISOString(),
    });
    const later = makeAttempt({
      id: 'later-any',
      score: 85,
      is_redo: false,  // not explicitly marked as redo
      allow_redo: false,
      created_at: new Date(2000).toISOString(),
      submitted_at: new Date(2000).toISOString(),
    });

    const result = detectCompletedReteachCycles([original, later], new Set());
    expect(result).toHaveLength(1);
    expect(result[0].redo_attempt_id).toBe('later-any');
  });
});

// ─── aggregateReteachStats ────────────────────────────────────────────────────

describe('aggregateReteachStats', () => {
  it('returns all-zero stats for empty cycles', () => {
    const stats = aggregateReteachStats([]);
    expect(stats).toMatchObject({
      total_cycles: 0,
      avg_improvement: 0,
      success_rate: 0,
      avg_pre_score: 0,
      avg_post_score: 0,
    });
    expect(stats.by_flagged_by.auto.count).toBe(0);
    expect(stats.by_flagged_by.teacher.count).toBe(0);
  });

  it('computes correct stats for mixed cycles', () => {
    const cycles: Pick<ReteachCycleRecord, 'pre_score' | 'post_score' | 'improvement' | 'flagged_by'>[] = [
      { pre_score: 50, post_score: 80, improvement: 30, flagged_by: 'teacher' },
      { pre_score: 60, post_score: 70, improvement: 10, flagged_by: 'teacher' },
      { pre_score: 55, post_score: 45, improvement: -10, flagged_by: 'auto' },
    ];
    const stats = aggregateReteachStats(cycles);
    expect(stats.total_cycles).toBe(3);
    expect(stats.avg_improvement).toBe(10);  // (30+10-10)/3 = 10
    expect(stats.success_rate).toBe(67);     // 2/3 = 66.7 → round to 67
    expect(stats.avg_pre_score).toBe(55);
    expect(stats.avg_post_score).toBe(65);
    expect(stats.by_flagged_by.teacher.count).toBe(2);
    expect(stats.by_flagged_by.teacher.avg_improvement).toBe(20); // (30+10)/2
    expect(stats.by_flagged_by.auto.count).toBe(1);
    expect(stats.by_flagged_by.auto.avg_improvement).toBe(-10);
  });
});
