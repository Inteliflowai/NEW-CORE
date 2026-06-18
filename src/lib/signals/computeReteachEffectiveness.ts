/**
 * CORE V2 — Reteach Effectiveness Computation
 *
 * Verbatim lift of V1 computeReteachEffectiveness.ts.
 *
 * A "reteach cycle" is complete when:
 *   1. A homework_attempt was flagged for reteach (allow_redo = true)
 *   2. A new attempt exists for the same student + assignment after the flag
 *      (is_redo = true, or simply a later attempt on the same assignment)
 *   3. The redo attempt has a graded score.
 *
 * This module:
 *   - Detects newly completed cycles not yet in reteach_cycles
 *   - Computes pre_score, post_score, improvement
 *   - Returns records ready for upsert into reteach_cycles
 *
 * C18: homework_attempts has no class_id column — removed from HomeworkAttemptRow.
 *      Class scoping is a caller/route concern via assignments.
 */

export interface HomeworkAttemptRow {
  id: string;
  student_id: string;
  assignment_id: string;
  score: number | null;
  allow_redo: boolean;
  is_redo: boolean;
  flagged_by: 'auto' | 'teacher' | null; // which system triggered reteach
  submitted_at: string | null;
  created_at: string;
}

export interface ReteachCycleRecord {
  student_id: string;
  assignment_id: string;
  original_attempt_id: string;
  redo_attempt_id: string;
  pre_score: number;
  post_score: number;
  improvement: number;          // post - pre (can be negative)
  flagged_by: 'auto' | 'teacher';
  completed_at: string;         // redo submitted_at
}

/**
 * Given all homework_attempts for a student+assignment (any order),
 * returns completed reteach cycles not already recorded.
 *
 * `existingCyclePairs` is a Set of "originalId:redoId" strings
 * already in the reteach_cycles table so we don't re-insert.
 */
export function detectCompletedReteachCycles(
  attempts: HomeworkAttemptRow[],
  existingCyclePairs: Set<string>
): ReteachCycleRecord[] {
  const results: ReteachCycleRecord[] = [];

  // Group by assignment_id
  const byAssignment = new Map<string, HomeworkAttemptRow[]>();
  for (const attempt of attempts) {
    if (!byAssignment.has(attempt.assignment_id)) {
      byAssignment.set(attempt.assignment_id, []);
    }
    byAssignment.get(attempt.assignment_id)!.push(attempt);
  }

  for (const [, assignmentAttempts] of byAssignment) {
    // Sort chronologically
    const sorted = [...assignmentAttempts].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // Find attempts flagged for redo (allow_redo = true, has a score)
    const flaggedAttempts = sorted.filter(
      (a) => a.allow_redo && a.score !== null
    );

    for (const original of flaggedAttempts) {
      // Find a later attempt on the same assignment that is a redo
      const redoAttempt = sorted.find(
        (a) =>
          a.id !== original.id &&
          a.score !== null &&
          a.submitted_at !== null &&
          new Date(a.created_at) > new Date(original.created_at) &&
          (a.is_redo || true) // accept any later graded attempt as redo
      );

      if (!redoAttempt) continue;
      if (redoAttempt.score === null) continue;

      const pairKey = `${original.id}:${redoAttempt.id}`;
      if (existingCyclePairs.has(pairKey)) continue;

      results.push({
        student_id: original.student_id,
        assignment_id: original.assignment_id,
        original_attempt_id: original.id,
        redo_attempt_id: redoAttempt.id,
        pre_score: original.score!,
        post_score: redoAttempt.score,
        improvement: redoAttempt.score - original.score!,
        flagged_by: original.flagged_by ?? 'teacher',
        completed_at: redoAttempt.submitted_at ?? redoAttempt.created_at,
      });
    }
  }

  return results;
}

// ─── Aggregate stats (used by teacher UI in Phase 3) ─────────────────────────

export interface ReteachEffectivenessStats {
  total_cycles: number;
  avg_improvement: number;
  success_rate: number;       // % of cycles with improvement > 0
  avg_pre_score: number;
  avg_post_score: number;
  by_flagged_by: {
    auto: { count: number; avg_improvement: number };
    teacher: { count: number; avg_improvement: number };
  };
}

export function aggregateReteachStats(
  cycles: Pick<ReteachCycleRecord, 'pre_score' | 'post_score' | 'improvement' | 'flagged_by'>[]
): ReteachEffectivenessStats {
  if (!cycles.length) {
    return {
      total_cycles: 0,
      avg_improvement: 0,
      success_rate: 0,
      avg_pre_score: 0,
      avg_post_score: 0,
      by_flagged_by: {
        auto: { count: 0, avg_improvement: 0 },
        teacher: { count: 0, avg_improvement: 0 },
      },
    };
  }

  const avg = (nums: number[]) =>
    nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;

  const autoCycles = cycles.filter((c) => c.flagged_by === 'auto');
  const teacherCycles = cycles.filter((c) => c.flagged_by === 'teacher');

  return {
    total_cycles: cycles.length,
    avg_improvement: Math.round(avg(cycles.map((c) => c.improvement))),
    success_rate: Math.round(
      (cycles.filter((c) => c.improvement > 0).length / cycles.length) * 100
    ),
    avg_pre_score: Math.round(avg(cycles.map((c) => c.pre_score))),
    avg_post_score: Math.round(avg(cycles.map((c) => c.post_score))),
    by_flagged_by: {
      auto: {
        count: autoCycles.length,
        avg_improvement: Math.round(avg(autoCycles.map((c) => c.improvement))),
      },
      teacher: {
        count: teacherCycles.length,
        avg_improvement: Math.round(avg(teacherCycles.map((c) => c.improvement))),
      },
    },
  };
}
