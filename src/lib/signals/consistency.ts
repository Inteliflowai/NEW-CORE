/**
 * CORE V2 — Consistency score/label + trajectory
 *
 * computeConsistency: lifted verbatim from V1 lib/studentModel.ts lines 266–276.
 * computeTrajectory:  lifted verbatim from V1 lib/signals/signalComputer.ts computeTrend lines 423–438.
 *
 * Both are pure, import-safe (no next/server, no DB calls).
 *
 * BINDING CORRECTION P3-C6:
 *   computeTrajectory's `lowerIsBetter` defaults to `true` (V1 default preserved).
 *   Quiz-score callers (higher = better) MUST pass `lowerIsBetter = false`.
 */

export type ConsistencyLabel = 'consistent' | 'variable' | 'erratic';
export type TrajectoryDirection = 'improving' | 'stable' | 'worsening';

export interface ConsistencyResult {
  consistency_score: number | null;
  consistency_label: ConsistencyLabel | null;
}

export interface TrajectoryResult {
  trajectory: TrajectoryDirection;
}

// ─── computeConsistency ──────────────────────────────────────────────────────
// Lifted verbatim from V1 studentModel.ts:266-276.
// Caller is responsible for passing the last-5 quiz score_pct values.
// Returns null/null for cold-start (fewer than 3 scores).

export function computeConsistency(quizScorePcts: number[]): ConsistencyResult {
  if (quizScorePcts.length < 3) {
    return { consistency_score: null, consistency_label: null };
  }

  const scores = quizScorePcts;
  const mean = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum: number, s: number) => sum + (s - mean) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const consistencyScore = stdDev <= 5 ? 95 + (5 - stdDev)
    : stdDev <= 15 ? 70 + (15 - stdDev) * 2.5
    : stdDev <= 25 ? 40 + (25 - stdDev) * 3
    : Math.max(0, 40 - (stdDev - 25) * 2);
  const consistency_score = Math.round(Math.min(100, Math.max(0, consistencyScore)));
  const consistency_label: ConsistencyLabel = consistencyScore >= 70
    ? 'consistent'
    : consistencyScore >= 40
      ? 'variable'
      : 'erratic';

  return { consistency_score, consistency_label };
}

// ─── computeTrajectory ──────────────────────────────────────────────────────
// Lifted verbatim from V1 lib/signals/signalComputer.ts computeTrend lines 423-438.
// history: ordered oldest → newest (e.g. weekly snapshot score_pct values).
//
// lowerIsBetter=true  (V1 default): a DROP in values is "improving" (e.g. risk score).
// lowerIsBetter=false: a RISE in values is "improving" (e.g. quiz score ← use this).
//
// NOTE for quiz-score callers: pass `lowerIsBetter = false`.
//
// Returns 'stable' until ≥4 history points are available (cold-start guard).

function avgArr(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function computeTrajectory(
  history: number[],
  lowerIsBetter = true,
): TrajectoryResult {
  if (history.length < 4) return { trajectory: 'stable' };
  const recent = history.slice(-3);
  const older = history.slice(-6, -3);
  if (!older.length) return { trajectory: 'stable' };
  const recentAvg = avgArr(recent);
  const olderAvg = avgArr(older);
  const delta = (recentAvg - olderAvg) / Math.max(olderAvg, 0.01);
  const threshold = 0.1;
  if (Math.abs(delta) < threshold) return { trajectory: 'stable' };
  const isIncreasing = delta > 0;
  const trajectory: TrajectoryDirection = (lowerIsBetter ? !isIncreasing : isIncreasing)
    ? 'improving'
    : 'worsening';
  return { trajectory };
}
