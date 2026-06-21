/**
 * CORE V2 Behavioral Signal Computer
 *
 * Port of V1 lib/signals/signalComputer.ts → computeSignals() + helpers.
 * Pure function: no DB, no Date.now(), no random. All 0–1 scores are clamped.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * STEP 0 — PER-SIGNAL AGGREGATE COVERAGE (Verification Gate)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * For each V1 computed signal, the table below documents how V1 used the raw
 * StudentEvent[] and what V2 aggregate/field covers the same information.
 *
 * ┌────────────────────┬───────────────────────────────────────┬────────────────────────────────────────────────────────────┐
 * │ Signal             │ V1 event usage                        │ V2 aggregate / field                                       │
 * ├────────────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────┤
 * │ learningVelocity   │ questionAttempts[] only               │ questionAttempts[] — no events needed                      │
 * │ velocityTrend      │ questionAttempts[].timeTakenMs        │ questionAttempts[].timeTakenMs — no events needed           │
 * ├────────────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────┤
 * │ frustrationScore   │ keypress count → backspace rate       │ aggregates.backspaceCount / aggregates.keypressCount [ADD] │
 * │                    │ attempts.changeCount (multi-attempt)  │ questionAttempts[].changeCount — direct                    │
 * │                    │ attempts.changeCount ≥ 3 (thrashing)  │ questionAttempts[].changeCount — direct                    │
 * │                    │ focus_loss count                      │ aggregates.focusLossCount — direct                         │
 * │                    │ pause_end→backspace sequence          │ aggregates.stuckEraseCount [ADD] — runner captures count   │
 * │                    │ hint_request count                    │ sum(questionAttempts[].hintsUsed) — computable             │
 * ├────────────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────┤
 * │ attentionScore     │ focus_loss count → gaps               │ aggregates.focusLossCount — direct                         │
 * │                    │ sum(focus_gain.ts - focus_loss.ts)    │ aggregates.totalFocusLossMs [ADD]                          │
 * │                    │ question_next.timeTakenMs variance    │ questionAttempts[].timeTakenMs — computable                │
 * ├────────────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────┤
 * │ errorPatternType   │ questionAttempts[] only               │ questionAttempts[] — no events needed                      │
 * │ errorFrequency     │ questionAttempts[] only               │ questionAttempts[] — no events needed                      │
 * ├────────────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────┤
 * │ confidenceScore    │ questionAttempts[].timeTakenMs        │ questionAttempts[].timeTakenMs — no events needed           │
 * │ confidenceAccuracy │ Pearson(speed, isCorrect)             │ questionAttempts[] — no events needed                      │
 * ├────────────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────┤
 * │ engagementScore    │ hint_request count                    │ sum(questionAttempts[].hintsUsed) — computable             │
 * │                    │ canvas_start (boolean)                │ aggregates.canvasUsed [ADD]                                │
 * │                    │ backspace / keypress rate             │ aggregates.backspaceCount / keypressCount [ADD]            │
 * │                    │ durationMs / attempts (avgTimePer)    │ derive from sessionEndMs - sessionStartMs                  │
 * │                    │ tts_play count                        │ aggregates.ttsPlayCount [ADD]                              │
 * │                    │ focus_loss count                      │ aggregates.focusLossCount — direct                         │
 * ├────────────────────┼───────────────────────────────────────┼────────────────────────────────────────────────────────────┤
 * │ predictiveRisk     │ derived from sub-signals only         │ no events needed — all sub-signals available above         │
 * └────────────────────┴───────────────────────────────────────┴────────────────────────────────────────────────────────────┘
 *
 * ADDED fields in SessionAggregates (not in brief — task 1 migration follow-up):
 *   totalFocusLossMs  — required by attentionScore away-fraction calculation
 *   backspaceCount    — required by frustration high-correction-rate + engagement backspaceRate
 *   keypressCount     — required as denominator for backspaceRate
 *   ttsPlayCount      — required by engagement exploratory-style detection
 *   canvasUsed        — required by engagement exploratory-style detection
 *   stuckEraseCount   — required by frustration stuck-and-erase sub-signal (pause>3s → backspace)
 *                       Default 0 until Phase 2/3 runner instrumentation; signal fires at ≥ 3.
 */

import type {
  RawSessionData,
  ComputedSignals,
  QuestionAttemptData,
  SessionAggregates,
} from './behavioralTypes';

// ─── Main entry ────────────────────────────────────────────────────────────

export function computeSignals(session: RawSessionData): ComputedSignals {
  const { questionAttempts = [], aggregates, sessionStartMs, sessionEndMs } = session;
  const durationMs = sessionEndMs - sessionStartMs;
  const durationMin = Math.max(durationMs / 60000, 0.1);

  const velocity = computeVelocity(questionAttempts, durationMin);
  const frustration = computeFrustration(aggregates, questionAttempts);
  const attention = computeAttention(aggregates, durationMs, questionAttempts);
  const errorPattern = computeErrorPattern(questionAttempts);
  const confidence = computeConfidence(questionAttempts);
  const engagement = computeEngagement(aggregates, questionAttempts, durationMs);
  const risk = computeRisk({ velocity, frustration, attention, errorPattern, confidence, engagement });

  return {
    learningVelocity: velocity.value,
    velocityTrend: velocity.trend,
    frustrationScore: frustration.score,
    frustrationIndicators: frustration.indicators,
    attentionScore: attention.score,
    attentionGaps: attention.gaps,
    errorPatternType: errorPattern.type,
    errorFrequency: errorPattern.frequency,
    confidenceScore: confidence.score,
    confidenceAccuracy: confidence.accuracy,
    engagementScore: engagement.score,
    engagementStyle: engagement.style,
    predictiveRiskScore: risk.score,
    riskFactors: risk.factors,
    sessionDurationMs: durationMs,
  };
}

// ─── Learning Velocity ─────────────────────────────────────────────────────
// V2 adaptation: identical to V1 — uses questionAttempts[] only, no events.

function computeVelocity(
  attempts: QuestionAttemptData[],
  durationMin: number,
): { value: number; trend: ComputedSignals['velocityTrend'] } {
  if (!attempts.length) return { value: 0, trend: 'stable' };

  const correct = attempts.filter((a) => a.isCorrect);
  const value = correct.length / durationMin;

  // Compare pace of first half vs second half
  const mid = Math.floor(attempts.length / 2);
  const firstHalf = attempts.slice(0, mid);
  const secondHalf = attempts.slice(mid);

  if (firstHalf.length < 2 || secondHalf.length < 2) {
    return { value: round2(value), trend: 'stable' };
  }

  const firstAvgTime = avg(firstHalf.map((a) => a.timeTakenMs));
  const secondAvgTime = avg(secondHalf.map((a) => a.timeTakenMs));
  const delta = (firstAvgTime - secondAvgTime) / firstAvgTime; // positive = getting faster

  let trend: ComputedSignals['velocityTrend'] = 'stable';
  if (delta > 0.2) trend = 'accelerating';
  else if (delta < -0.2) trend = 'decelerating';

  return { value: round2(value), trend };
}

// ─── Frustration ───────────────────────────────────────────────────────────
// V2 adaptation: event-derived values replaced by SessionAggregates counts.
//   backspace rate  → aggregates.backspaceCount / aggregates.keypressCount
//   focus_loss count→ aggregates.focusLossCount
//   changeCount     → questionAttempts[].changeCount (unchanged)
//   hints           → sum(questionAttempts[].hintsUsed)
//   pause→backspace → aggregates.stuckEraseCount (runner captures count; default 0 until Phase 2/3)

function computeFrustration(
  aggregates: SessionAggregates,
  attempts: QuestionAttemptData[],
): { score: number; indicators: string[] } {
  const indicators: string[] = [];
  let score = 0;

  // 1. High backspace rate (> 35%) — V2: uses backspaceCount / keypressCount
  const keypresses = aggregates.keypressCount;
  const backspaces = aggregates.backspaceCount;
  if (keypresses > 10) {
    const bsRate = backspaces / (keypresses + backspaces);
    if (bsRate > 0.35) {
      score += 0.25;
      indicators.push('High correction rate');
    } else if (bsRate > 0.2) {
      score += 0.1;
    }
  }

  // 2. Multiple wrong attempts on same question (changeCount ≥ 2 on wrong)
  const multiAttempt = attempts.filter((a) => !a.isCorrect && a.changeCount >= 2);
  if (multiAttempt.length > 0) {
    const rate = multiAttempt.length / Math.max(attempts.length, 1);
    score += Math.min(rate * 0.4, 0.3);
    if (rate > 0.3) indicators.push('Repeated wrong answers');
  }

  // 3. Answer thrashing (changeCount ≥ 3 on any question)
  const thrashing = attempts.filter((a) => a.changeCount >= 3).length;
  if (thrashing > 0) {
    score += Math.min(thrashing * 0.1, 0.2);
    indicators.push('Frequent answer changes');
  }

  // 4. Focus loss during answering — V2: aggregates.focusLossCount
  const focusLoss = aggregates.focusLossCount;
  if (focusLoss >= 3) {
    score += Math.min(focusLoss * 0.05, 0.2);
    indicators.push('Repeated loss of focus');
  }

  // 5. Stuck-and-erase pattern — V2: aggregates.stuckEraseCount
  //    V1 counted pause_end→backspace sequences where the pause was >3000ms;
  //    V2 runner captures this as a count (default 0 until Phase 2/3 instrumentation).
  if (aggregates.stuckEraseCount >= 3) {
    score += 0.1;
    indicators.push('Stuck-and-erase pattern');
  }

  // 6. Hint requests — V2: sum hintsUsed across attempts
  const hintCount = attempts.reduce((s, a) => s + a.hintsUsed, 0);
  if (hintCount >= 3) {
    score += Math.min(hintCount * 0.05, 0.15);
    indicators.push('Frequent hint requests');
  }

  return { score: clamp01(score), indicators };
}

// ─── Attention ─────────────────────────────────────────────────────────────
// V2 adaptation:
//   focus_loss count → aggregates.focusLossCount
//   sum of gap durations → aggregates.totalFocusLossMs (added to SessionAggregates)
//   response time variance → questionAttempts[].timeTakenMs (unchanged)

function computeAttention(
  aggregates: SessionAggregates,
  durationMs: number,
  attempts: QuestionAttemptData[],
): { score: number; gaps: number } {
  const gaps = aggregates.focusLossCount;

  if (durationMs < 5000) return { score: 1, gaps: 0 };

  // Fraction of session spent away from window
  const awayFraction = Math.min(aggregates.totalFocusLossMs / durationMs, 1);

  // Response time variance: high variance = lower attention
  const responseTimes = attempts.map((a) => a.timeTakenMs);
  let variancePenalty = 0;
  if (responseTimes.length >= 3) {
    const cv = coefficientOfVariation(responseTimes);
    variancePenalty = Math.min(cv * 0.3, 0.2);
  }

  const score = clamp01(1 - awayFraction * 0.7 - variancePenalty - gaps * 0.02);
  return { score: round2(score), gaps };
}

// ─── Error Pattern ─────────────────────────────────────────────────────────
// V2 adaptation: identical to V1 — uses questionAttempts[] only, no events.

function computeErrorPattern(
  attempts: QuestionAttemptData[],
): { type: ComputedSignals['errorPatternType']; frequency: number } {
  if (attempts.length < 3) {
    return { type: 'insufficient_data', frequency: 0 };
  }

  const errors = attempts.filter((a) => !a.isCorrect);
  const frequency = round2(errors.length / attempts.length);

  if (errors.length === 0) {
    return { type: 'random', frequency: 0 };
  }

  const errorTimes = errors.map((a) => a.timeTakenMs);
  const correctTimes = attempts.filter((a) => a.isCorrect).map((a) => a.timeTakenMs);

  if (correctTimes.length > 0 && errorTimes.length > 0) {
    const avgErrorTime = avg(errorTimes);
    const avgCorrectTime = avg(correctTimes);

    // Careless: errors much faster than correct (rushed)
    if (avgErrorTime < avgCorrectTime * 0.6) {
      return { type: 'careless', frequency };
    }

    // Conceptual: errors much slower than correct (struggling with concept)
    if (avgErrorTime > avgCorrectTime * 1.8) {
      return { type: 'conceptual', frequency };
    }
  }

  // Procedural: many answer changes on error questions (knows concept, wrong steps)
  const avgChangesOnErrors = avg(errors.map((a) => a.changeCount));
  if (avgChangesOnErrors >= 2) {
    return { type: 'procedural', frequency };
  }

  return { type: 'random', frequency };
}

// ─── Confidence Calibration ────────────────────────────────────────────────
// V2 adaptation: identical to V1 — uses questionAttempts[] only, no events.

function computeConfidence(
  attempts: QuestionAttemptData[],
): { score: number; accuracy: number } {
  if (attempts.length < 3) return { score: 0.5, accuracy: 0 };

  const times = attempts.map((a) => a.timeTakenMs);
  const maxTime = Math.max(...times);
  const minTime = Math.min(...times);
  const range = maxTime - minTime || 1;

  // Confidence scores: higher for faster responses (inverted, normalized)
  const confidenceScores = attempts.map((a) => 1 - (a.timeTakenMs - minTime) / range);
  const avgConfidence = avg(confidenceScores);

  // Accuracy of confidence: Pearson correlation between speed and correctness
  const correct = attempts.map((a) => (a.isCorrect ? 1 : 0));
  const correlation = pearsonCorrelation(confidenceScores, correct);

  // Calibration: map [-1,1] → [0,1]
  const accuracy = clamp01((correlation + 1) / 2);

  return { score: round2(avgConfidence), accuracy: round2(accuracy) };
}

// ─── Engagement ─────────────────────────────────────────────────────────────
// V2 adaptation:
//   hint_request count → sum(questionAttempts[].hintsUsed)
//   canvas_start       → aggregates.canvasUsed  (added to SessionAggregates)
//   backspace rate     → aggregates.backspaceCount / aggregates.keypressCount
//   tts_play count     → aggregates.ttsPlayCount  (added to SessionAggregates)
//   focus_loss count   → aggregates.focusLossCount

function computeEngagement(
  aggregates: SessionAggregates,
  attempts: QuestionAttemptData[],
  durationMs: number,
): { score: number; style: ComputedSignals['engagementStyle'] } {
  if (!attempts.length) return { score: 0.3, style: 'passive' };

  const hintRequests = attempts.reduce((s, a) => s + a.hintsUsed, 0);
  const canvasUsed = aggregates.canvasUsed;
  const backspaceRate =
    aggregates.backspaceCount /
    Math.max(aggregates.keypressCount, 1);
  const avgTimePer = durationMs / Math.max(attempts.length, 1);
  const ttsPlays = aggregates.ttsPlayCount;
  const focusLoss = aggregates.focusLossCount;

  // Score components (verbatim weights from V1)
  let score = 0.5;
  if (canvasUsed) score += 0.1;
  if (ttsPlays > 0) score += 0.05;
  if (hintRequests > 0 && hintRequests <= 3) score += 0.05;
  if (focusLoss === 0) score += 0.1;
  if (backspaceRate < 0.15) score += 0.1;
  score -= focusLoss * 0.03;
  score -= Math.max(backspaceRate - 0.3, 0) * 0.5;

  // Style classification (verbatim thresholds from V1)
  const isImpulsive = backspaceRate > 0.3 && avgTimePer < 15000;
  const isExploratory = hintRequests >= 2 || ttsPlays >= 2 || canvasUsed;
  const isPassive = focusLoss >= 4;
  const isMethodical = !isImpulsive && !isExploratory && !isPassive && backspaceRate < 0.15;

  let style: ComputedSignals['engagementStyle'];
  if (isPassive) style = 'passive';
  else if (isImpulsive) style = 'impulsive';
  else if (isExploratory) style = 'exploratory';
  else style = 'methodical';

  return { score: clamp01(round2(score)), style };
}

// ─── Predictive Risk ──────────────────────────────────────────────────────
// V2 adaptation: identical to V1 — derived entirely from sub-signals, no events.

function computeRisk(signals: {
  velocity: { value: number; trend: string };
  frustration: { score: number; indicators: string[] };
  attention: { score: number; gaps: number };
  errorPattern: { type: string; frequency: number };
  confidence: { score: number; accuracy: number };
  engagement: { score: number; style: string };
}): { score: number; factors: string[] } {
  const factors: string[] = [];
  let riskScore = 0;

  // Frustration (weight: 0.30)
  riskScore += signals.frustration.score * 0.30;
  if (signals.frustration.score > 0.6) factors.push(...signals.frustration.indicators);

  // Attention (weight: 0.20) — low attention = higher risk
  const attentionRisk = 1 - signals.attention.score;
  riskScore += attentionRisk * 0.20;
  if (attentionRisk > 0.5) factors.push('Low attention / frequent distraction');

  // Velocity trend (weight: 0.20)
  const velocityRisk =
    signals.velocity.trend === 'decelerating'
      ? 0.8
      : signals.velocity.trend === 'stable'
        ? 0.3
        : 0.05;
  riskScore += velocityRisk * 0.20;
  if (signals.velocity.trend === 'decelerating') factors.push('Slowing learning pace');

  // Error pattern (weight: 0.15)
  const errorRisk =
    signals.errorPattern.type === 'conceptual'
      ? 0.9
      : signals.errorPattern.type === 'procedural'
        ? 0.6
        : signals.errorPattern.type === 'careless'
          ? 0.4
          : 0.2;
  riskScore += errorRisk * signals.errorPattern.frequency * 0.15;
  if (signals.errorPattern.type === 'conceptual' && signals.errorPattern.frequency > 0.4) {
    factors.push('Conceptual misunderstanding pattern');
  }

  // Confidence calibration (weight: 0.10) — poor calibration = risk
  const calibrationRisk = 1 - signals.confidence.accuracy;
  riskScore += calibrationRisk * 0.10;
  if (calibrationRisk > 0.6) factors.push('Poor confidence calibration');

  // Engagement (weight: 0.05)
  const engagementRisk = 1 - signals.engagement.score;
  riskScore += engagementRisk * 0.05;
  if (signals.engagement.style === 'passive') factors.push('Passive engagement');

  return { score: clamp01(round2(riskScore)), factors };
}

// ─── Math utilities ────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function coefficientOfVariation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = avg(arr);
  if (mean === 0) return 0;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance) / mean;
}

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
