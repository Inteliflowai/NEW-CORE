/**
 * CORE V2 — Session Risk Computation
 *
 * ENSEMBLE WEIGHTS: verbatim from V1 signalComputer.ts computeRisk() (lines 323–366).
 *   frustration × 0.30
 *   (1 - attention) × 0.20
 *   velocityRisk × 0.20
 *   (errorRisk × errorFrequency) × 0.15
 *   (1 - confidenceAccuracy) × 0.10
 *   (1 - engagement) × 0.05
 *
 *   velocityRisk: decelerating→0.8 | stable→0.3 | accelerating→0.05  (verbatim)
 *   errorRisk:    conceptual→0.9 | procedural→0.6 | careless→0.4 | other→0.2  (verbatim)
 *
 * V2 ADAPTATION: sub-scores are derived from quiz_responses telemetry columns
 *   (response_time_ms, hesitation_ms, answer_changes, navigation_backs,
 *    pause_count, total_pause_ms, word_count) aggregated per attempt.
 *   V1 derived these from a rich StudentEvent[] stream and QuestionAttemptData[];
 *   V2 uses the persisted per-response telemetry columns as the proxy.
 *
 * PILOT-RECALIBRATION TARGET: once ≥200 sessions are collected, run a
 *   logistic regression of risk_score → actual_reteach_needed outcomes and
 *   recalibrate the sub-score derivation thresholds in computeSessionSignals()
 *   below. The ensemble weights should remain fixed unless Barb approves a change.
 *
 * CORRECTION C13 — ALL-ZERO TELEMETRY IS NEUTRAL (not 0.135):
 *   With all sub-scores zero, the verbatim ensemble would return ≈0.135
 *   (velocity-stable 0.3×0.2 + calibration 0.5×0.1 + engagement 0.5×0.05).
 *   Until the Plan-4 quiz UI captures telemetry, rows are all-zero — that must
 *   read as no risk. Guard: if the responses array is empty OR every telemetry
 *   field across all responses is zero/absent, return {score:0,factors:[]}.
 *   The ensemble + weights stay verbatim for the real-telemetry path.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** One row from quiz_responses with the V2 telemetry columns */
export interface QuizResponseTelemetry {
  response_time_ms: number;   // total time on question (ms)
  hesitation_ms: number;      // pre-keystroke hesitation (ms)
  answer_changes: number;     // number of times student changed answer
  navigation_backs: number;   // number of backwards navigations on this question
  pause_count: number;        // number of pauses during response
  total_pause_ms: number;     // total ms spent in pauses
  word_count: number;         // words in final response (OEQ proxy for effort)
  is_correct: boolean | null; // null = ungraded
}

/** Intermediate sub-scores mirroring V1 signal shape */
export interface SessionSignals {
  frustration: number;        // [0,1]
  attention: number;          // [0,1]  (high = attentive)
  velocityTrend: 'decelerating' | 'stable' | 'accelerating';
  errorPatternType: 'conceptual' | 'procedural' | 'careless' | 'other';
  errorFrequency: number;     // [0,1]
  confidenceAccuracy: number; // [0,1]  (high = well-calibrated)
  engagement: number;         // [0,1]
}

export interface SessionRiskResult {
  score: number;   // [0,1] — verbatim ensemble
  factors: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─── Pearson correlation (copied from V1 signalComputer.ts) ──────────────────

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const avgA = avg(a);
  const avgB = avg(b);
  const num = a.reduce((sum, ai, i) => sum + (ai - avgA) * (b[i] - avgB), 0);
  const denomA = Math.sqrt(a.reduce((sum, ai) => sum + (ai - avgA) ** 2, 0));
  const denomB = Math.sqrt(b.reduce((sum, bi) => sum + (bi - avgB) ** 2, 0));
  if (denomA === 0 || denomB === 0) return 0;
  return num / (denomA * denomB);
}

// ─── C13 guard — detect all-zero telemetry ───────────────────────────────────

/**
 * Returns true if every numeric telemetry field across all responses is zero
 * (or the array is empty). Used to short-circuit the ensemble and return
 * {score:0,factors:[]} — C13 all-zero-neutral guard.
 */
function isAllZeroTelemetry(responses: QuizResponseTelemetry[]): boolean {
  if (!responses.length) return true;
  return responses.every(
    (r) =>
      (r.response_time_ms ?? 0) === 0 &&
      (r.hesitation_ms ?? 0) === 0 &&
      (r.answer_changes ?? 0) === 0 &&
      (r.navigation_backs ?? 0) === 0 &&
      (r.pause_count ?? 0) === 0 &&
      (r.total_pause_ms ?? 0) === 0 &&
      (r.word_count ?? 0) === 0,
  );
}

// ─── V2 sub-score derivation (the ONE adaptation) ────────────────────────────

/**
 * Maps V2 quiz_responses telemetry → SessionSignals.
 * Where telemetry is all-zero or absent, returns neutral sub-scores
 * (frustration=0, attention=1, velocityTrend='stable', errorPatternType='other',
 *  errorFrequency=0, confidenceAccuracy=0.5, engagement=0.5) — no fabricated risk.
 *
 * NOTE: This function computes genuine signals when real telemetry is present.
 * The sub-score thresholds below are V2 pilot estimates; recalibrate against
 * ≥200 sessions once data is available (see PILOT-RECALIBRATION TARGET above).
 */
export function computeSessionSignals(
  responses: QuizResponseTelemetry[],
): SessionSignals {
  if (!responses.length) {
    return {
      frustration: 0,
      attention: 1,
      velocityTrend: 'stable',
      errorPatternType: 'other',
      errorFrequency: 0,
      confidenceAccuracy: 0.5,
      engagement: 0.5,
    };
  }

  // ── Frustration ── proxy: answer_changes + navigation_backs + hesitation
  // High answer_changes or navigation_backs per question signals stuck/frustrated.
  const avgChanges = avg(responses.map((r) => r.answer_changes));
  const avgNavBacks = avg(responses.map((r) => r.navigation_backs));
  const avgHesitationFrac = avg(
    responses.map((r) =>
      r.response_time_ms > 0 ? r.hesitation_ms / r.response_time_ms : 0,
    ),
  );
  let frustration = 0;
  if (avgChanges >= 3) frustration += 0.3;
  else if (avgChanges >= 1.5) frustration += 0.15;
  if (avgNavBacks >= 2) frustration += 0.2;
  else if (avgNavBacks >= 1) frustration += 0.1;
  if (avgHesitationFrac > 0.5) frustration += 0.2;
  else if (avgHesitationFrac > 0.3) frustration += 0.1;
  frustration = clamp01(frustration);

  // ── Attention ── proxy: pause_count + total_pause_ms fraction
  // High pause fraction of total response time = off-task.
  const totalResponseMs = responses.reduce((s, r) => s + r.response_time_ms, 0);
  const totalPauseMs = responses.reduce((s, r) => s + r.total_pause_ms, 0);
  const pauseFraction = totalResponseMs > 0 ? totalPauseMs / totalResponseMs : 0;
  const avgPauseCount = avg(responses.map((r) => r.pause_count));
  let attentionPenalty = 0;
  if (pauseFraction > 0.4) attentionPenalty += 0.4;
  else if (pauseFraction > 0.2) attentionPenalty += 0.2;
  if (avgPauseCount > 4) attentionPenalty += 0.2;
  const attention = clamp01(1 - attentionPenalty);

  // ── Velocity trend ── compare response_time_ms of first half vs second half
  let velocityTrend: 'decelerating' | 'stable' | 'accelerating' = 'stable';
  const mid = Math.floor(responses.length / 2);
  if (mid >= 1 && responses.length - mid >= 1) {
    const firstHalfAvg = avg(responses.slice(0, mid).map((r) => r.response_time_ms));
    const secondHalfAvg = avg(responses.slice(mid).map((r) => r.response_time_ms));
    if (firstHalfAvg > 0) {
      const delta = (firstHalfAvg - secondHalfAvg) / firstHalfAvg; // positive = getting faster
      if (delta > 0.2) velocityTrend = 'accelerating';
      else if (delta < -0.2) velocityTrend = 'decelerating';
    }
  }

  // ── Error pattern ── proxy: is_correct + response_time_ms + answer_changes
  const gradedResponses = responses.filter((r) => r.is_correct !== null);
  let errorPatternType: 'conceptual' | 'procedural' | 'careless' | 'other' = 'other';
  let errorFrequency = 0;

  if (gradedResponses.length >= 2) {
    const errors = gradedResponses.filter((r) => r.is_correct === false);
    errorFrequency = round2(errors.length / gradedResponses.length);

    if (errors.length > 0) {
      const correct = gradedResponses.filter((r) => r.is_correct === true);
      const avgErrorTime = avg(errors.map((r) => r.response_time_ms));
      const avgCorrectTime = avg(correct.map((r) => r.response_time_ms));

      if (avgCorrectTime > 0) {
        // Careless: errors much faster than correct (rushed)
        if (avgErrorTime < avgCorrectTime * 0.6) {
          errorPatternType = 'careless';
        }
        // Conceptual: errors much slower than correct (struggling with concept)
        else if (avgErrorTime > avgCorrectTime * 1.8) {
          errorPatternType = 'conceptual';
        }
        // Procedural: many answer changes on error questions (knows concept, wrong steps)
        else {
          const avgChangesOnErrors = avg(errors.map((r) => r.answer_changes));
          if (avgChangesOnErrors >= 2) {
            errorPatternType = 'procedural';
          }
        }
      }
    }
  }

  // ── Confidence accuracy ── proxy: correlation between response speed and correctness
  // Faster responses on correct questions = well-calibrated confidence.
  let confidenceAccuracy = 0.5; // neutral when insufficient data
  if (gradedResponses.length >= 3) {
    const times = gradedResponses.map((r) => r.response_time_ms);
    const correctFlags = gradedResponses.map((r) => (r.is_correct ? 1 : 0));
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);
    const range = maxTime - minTime || 1;
    // confidenceScore: higher for faster responses (inverted, normalized)
    const confidenceScores = gradedResponses.map(
      (r) => 1 - (r.response_time_ms - minTime) / range,
    );
    const correlation = pearsonCorrelation(confidenceScores, correctFlags);
    confidenceAccuracy = clamp01((correlation + 1) / 2); // map [-1,1] to [0,1]
  }

  // ── Engagement ── proxy: word_count (OEQ effort) + answer_changes + navigation_backs
  // High word_count on open questions and moderate changes = engaged.
  const avgWords = avg(responses.map((r) => r.word_count));
  let engagement = 0.5;
  if (avgWords >= 20) engagement += 0.2;
  else if (avgWords >= 8) engagement += 0.1;
  if (avgChanges >= 1 && avgChanges <= 2) engagement += 0.05; // some revision = engaged
  if (avgNavBacks >= 3) engagement -= 0.15; // excessive back-nav = disengaged
  if (avgPauseCount > 5) engagement -= 0.1;
  engagement = clamp01(round2(engagement));

  return {
    frustration,
    attention,
    velocityTrend,
    errorPatternType,
    errorFrequency,
    confidenceAccuracy,
    engagement,
  };
}

// ─── Ensemble (VERBATIM weights from V1 signalComputer.ts computeRisk) ───────

/**
 * Computes session risk from quiz_responses telemetry.
 *
 * Ensemble weights are VERBATIM from V1 signalComputer.ts computeRisk()
 * (lines 323–366). Sub-scores are derived from V2 telemetry by
 * computeSessionSignals() above.
 *
 * C13 guard: if the responses array is empty OR every telemetry field is
 * zero/absent across all responses, returns {score:0,factors:[]} immediately
 * (bypasses the ensemble). This prevents all-zero rows from producing ≈0.135
 * (the ensemble's neutral floor) before the Plan-4 quiz UI captures real data.
 */
export function computeSessionRisk(
  responses: QuizResponseTelemetry[],
): SessionRiskResult {
  // ── C13 all-zero-neutral guard ──────────────────────────────────────────────
  if (isAllZeroTelemetry(responses)) {
    return { score: 0, factors: [] };
  }

  const signals = computeSessionSignals(responses);
  const factors: string[] = [];
  let riskScore = 0;

  // Frustration (weight: 0.30)  — verbatim
  riskScore += signals.frustration * 0.30;
  if (signals.frustration > 0.6) factors.push('High frustration indicators');

  // Attention (weight: 0.20) — low attention = higher risk  — verbatim
  const attentionRisk = 1 - signals.attention;
  riskScore += attentionRisk * 0.20;
  if (attentionRisk > 0.5) factors.push('Low attention / frequent distraction');

  // Velocity trend (weight: 0.20)  — verbatim
  const velocityRisk =
    signals.velocityTrend === 'decelerating'
      ? 0.8
      : signals.velocityTrend === 'stable'
        ? 0.3
        : 0.05;
  riskScore += velocityRisk * 0.20;
  if (signals.velocityTrend === 'decelerating') factors.push('Slowing learning pace');

  // Error pattern (weight: 0.15)  — verbatim
  const errorRisk =
    signals.errorPatternType === 'conceptual'
      ? 0.9
      : signals.errorPatternType === 'procedural'
        ? 0.6
        : signals.errorPatternType === 'careless'
          ? 0.4
          : 0.2;
  riskScore += errorRisk * signals.errorFrequency * 0.15;
  if (signals.errorPatternType === 'conceptual' && signals.errorFrequency > 0.4) {
    factors.push('Conceptual misunderstanding pattern');
  }

  // Confidence calibration (weight: 0.10) — poor calibration = risk  — verbatim
  const calibrationRisk = 1 - signals.confidenceAccuracy;
  riskScore += calibrationRisk * 0.10;
  if (calibrationRisk > 0.6) factors.push('Poor confidence calibration');

  // Engagement (weight: 0.05)  — verbatim
  const engagementRisk = 1 - signals.engagement;
  riskScore += engagementRisk * 0.05;
  if (signals.engagement < 0.3) factors.push('Passive engagement');

  return { score: clamp01(round2(riskScore)), factors };
}
