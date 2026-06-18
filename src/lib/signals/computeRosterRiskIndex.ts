/**
 * CORE V2 — Learning Risk Index Computation
 *
 * Verbatim lift of V1 computeRiskIndex.ts.
 * Export renamed: computeRiskIndex → computeRosterRiskIndex.
 *
 * Produces a risk_score (0–100), risk_level, and risk_factors[]
 * for a single student within a class.
 *
 * Score bands:
 *   0–24   → 'low'
 *   25–49  → 'medium'
 *   50–74  → 'high'
 *   75–100 → 'critical'
 *
 * C24: accepts an optional `referenceDate` (defaults to `new Date()`) so that
 * the weekly-snapshot cron can inject a canonical date and re-runs are
 * deterministic. All recency calculations use `referenceDate` instead of
 * a bare `Date.now()`.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskResult {
  risk_score: number;
  risk_level: RiskLevel;
  risk_factors: string[];
}

export interface StudentSignalData {
  // Homework attempts (most recent first, same class)
  homeworkAttempts: {
    score: number | null;         // 0–100, null = ungraded
    submitted_at: string | null;  // ISO timestamp
    allow_redo: boolean;
    is_redo: boolean;
  }[];

  // Quiz attempts (most recent first, same class)
  quizAttempts: {
    score: number | null;
    submitted_at: string | null;
  }[];

  // Total assignments issued for this class
  totalAssigned: number;
}

// ─── Weights (must sum to 100) ───────────────────────────────────────────────
const W = {
  avgHwScore:       25,  // low avg hw score → risk
  avgQuizScore:     25,  // low avg quiz score → risk
  completionRate:   20,  // missing submissions → risk
  scoreTrend:       15,  // declining scores → risk
  redoRate:         10,  // high redo requests → risk
  recency:           5,  // long gap since last submission → risk
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Linear scale: maps val in [low, high] → penalty in [0, maxPenalty]. */
function scalePenalty(val: number, low: number, high: number, maxPenalty: number): number {
  const clamped = Math.max(low, Math.min(high, val));
  const fraction = (clamped - low) / (high - low);
  return fraction * maxPenalty;
}

/** Slope of a simple linear regression on the last N scores. */
function trendSlope(scores: number[]): number {
  const n = scores.length;
  if (n < 2) return 0;
  const xs = scores.map((_, i) => i);
  const xMean = avg(xs);
  const yMean = avg(scores);
  const num = xs.reduce((s, x, i) => s + (x - xMean) * (scores[i] - yMean), 0);
  const den = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Compute the longitudinal roster risk index for a single student.
 *
 * @param data          Raw attempt arrays + totalAssigned (C12: no pre-aggregates).
 * @param referenceDate Optional reference point for recency calculations (C24).
 *                      Defaults to `new Date()`. Pass a fixed date in tests or
 *                      the cron snapshot so re-runs are deterministic.
 */
export function computeRosterRiskIndex(
  data: StudentSignalData,
  referenceDate: Date = new Date(),
): RiskResult {
  const factors: string[] = [];
  let totalScore = 0;
  const nowMs = referenceDate.getTime();

  // ── 1. Average homework score ─────────────────────────────────────────────
  const gradedHw = data.homeworkAttempts
    .filter((a) => a.score !== null)
    .map((a) => a.score as number);

  if (gradedHw.length > 0) {
    const avgHw = avg(gradedHw);
    // High risk when avgHw < 60; zero risk when avgHw ≥ 85
    const penalty = scalePenalty(avgHw, 60, 85, W.avgHwScore);
    // Invert: low score → high penalty
    const hwPenalty = avgHw < 85 ? W.avgHwScore - penalty : 0;
    totalScore += hwPenalty;
    if (avgHw < 65) factors.push(`Low average assignment score (${Math.round(avgHw)}%)`);
  } else {
    // No graded hw at all is itself a signal
    totalScore += W.avgHwScore * 0.5;
    factors.push('No graded assignments on record');
  }

  // ── 2. Average quiz score ─────────────────────────────────────────────────
  const gradedQuiz = data.quizAttempts
    .filter((a) => a.score !== null)
    .map((a) => a.score as number);

  if (gradedQuiz.length > 0) {
    const avgQuiz = avg(gradedQuiz);
    const penalty = scalePenalty(avgQuiz, 60, 85, W.avgQuizScore);
    const quizPenalty = avgQuiz < 85 ? W.avgQuizScore - penalty : 0;
    totalScore += quizPenalty;
    if (avgQuiz < 65) factors.push(`Low average quiz score (${Math.round(avgQuiz)}%)`);
  } else {
    totalScore += W.avgQuizScore * 0.3;
  }

  // ── 3. Completion rate ────────────────────────────────────────────────────
  const submitted = data.homeworkAttempts.filter((a) => a.submitted_at !== null).length;
  const completionRate =
    data.totalAssigned > 0 ? submitted / data.totalAssigned : 1;

  // High risk when completionRate < 0.7; zero risk at 1.0
  const completionPenalty = scalePenalty(
    completionRate,
    0,      // worst case
    0.7,    // above this, penalty decreases
    W.completionRate
  );
  // Invert
  const adjustedCompletion =
    completionRate < 1
      ? W.completionRate * (1 - completionRate)
      : 0;
  totalScore += Math.max(completionPenalty, adjustedCompletion);

  if (completionRate < 0.7) {
    factors.push(`Low submission rate (${Math.round(completionRate * 100)}% of assignments submitted)`);
  } else if (completionRate < 0.9) {
    factors.push(`Missing some assignments (${Math.round(completionRate * 100)}% submitted)`);
  }

  // ── 4. Score trend (last 4 scores combined) ───────────────────────────────
  const recentScores = [
    ...gradedHw.slice(0, 4),
    ...gradedQuiz.slice(0, 4),
  ].slice(0, 6);

  if (recentScores.length >= 3) {
    // recentScores arrives NEWEST-first (the caller orders by created_at desc).
    // trendSlope assigns x by ascending array index, i.e. it assumes OLDEST-first,
    // so feeding it newest-first inverts the sign — an improving student would be
    // flagged "declining" and vice-versa (security review H5). Reverse to
    // chronological order before the regression.
    const slope = trendSlope([...recentScores].reverse());
    // slope < -3 per attempt is meaningful decline
    if (slope < -3) {
      const trendPenalty = Math.min(W.scoreTrend, scalePenalty(slope, -10, -3, W.scoreTrend));
      totalScore += trendPenalty;
      factors.push('Scores are declining over recent assignments');
    }
  }

  // ── 5. Redo rate ──────────────────────────────────────────────────────────
  const redoCount = data.homeworkAttempts.filter((a) => a.allow_redo || a.is_redo).length;
  const redoRate = data.homeworkAttempts.length > 0
    ? redoCount / data.homeworkAttempts.length
    : 0;

  if (redoRate > 0.4) {
    const redoPenalty = scalePenalty(redoRate, 0.4, 1.0, W.redoRate);
    totalScore += redoPenalty;
    factors.push(`High redo frequency (${Math.round(redoRate * 100)}% of assignments)`);
  }

  // ── 6. Recency (days since last submission) ───────────────────────────────
  const allTimestamps = [
    ...data.homeworkAttempts.map((a) => a.submitted_at),
    ...data.quizAttempts.map((a) => a.submitted_at),
  ].filter(Boolean) as string[];

  if (allTimestamps.length > 0) {
    const lastDate = new Date(
      Math.max(...allTimestamps.map((t) => new Date(t).getTime()))
    );
    const daysSince = (nowMs - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 7) {
      const recencyPenalty = scalePenalty(daysSince, 7, 21, W.recency);
      totalScore += recencyPenalty;
      factors.push(`No submissions in the past ${Math.round(daysSince)} days`);
    }
  } else {
    totalScore += W.recency;
    factors.push('No submissions on record');
  }

  // ── Clamp and classify ────────────────────────────────────────────────────
  const risk_score = Math.round(Math.min(100, Math.max(0, totalScore)));

  let risk_level: RiskLevel;
  if (risk_score < 25) risk_level = 'low';
  else if (risk_score < 50) risk_level = 'medium';
  else if (risk_score < 75) risk_level = 'high';
  else risk_level = 'critical';

  return { risk_score, risk_level, risk_factors: factors };
}
