import { describe, it, expect } from 'vitest';
import {
  computeSessionRisk,
  computeSessionSignals,
  type QuizResponseTelemetry,
} from '../computeSessionRisk';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResponse(overrides: Partial<QuizResponseTelemetry> = {}): QuizResponseTelemetry {
  return {
    response_time_ms: 10000,
    hesitation_ms: 500,
    answer_changes: 0,
    navigation_backs: 0,
    pause_count: 0,
    total_pause_ms: 0,
    word_count: 15,
    is_correct: true,
    ...overrides,
  };
}

function makeZeroResponse(): QuizResponseTelemetry {
  return {
    response_time_ms: 0,
    hesitation_ms: 0,
    answer_changes: 0,
    navigation_backs: 0,
    pause_count: 0,
    total_pause_ms: 0,
    word_count: 0,
    is_correct: null,
  };
}

// ─── C13: all-zero telemetry must be NEUTRAL (score 0, not 0.135) ────────────

describe('C13 — all-zero telemetry is neutral', () => {
  it('empty responses array → {score:0, factors:[]}', () => {
    const result = computeSessionRisk([]);
    expect(result.score).toBe(0);
    expect(result.factors).toHaveLength(0);
  });

  it('all-zero telemetry rows → score === 0 (NOT 0.135)', () => {
    const responses = Array.from({ length: 3 }, () => makeZeroResponse());
    const result = computeSessionRisk(responses);
    expect(result.score).toBe(0);
    expect(result.factors).toHaveLength(0);
  });

  it('all-zero with 5 rows → score === 0', () => {
    const responses = Array.from({ length: 5 }, () => makeZeroResponse());
    const result = computeSessionRisk(responses);
    expect(result.score).toBe(0);
  });

  it('single all-zero row → score === 0', () => {
    const result = computeSessionRisk([makeZeroResponse()]);
    expect(result.score).toBe(0);
  });
});

// ─── Ensemble weight math (verbatim from V1 signalComputer.ts) ───────────────

describe('computeSessionRisk — ensemble weight math', () => {
  it('frustration weight 0.30: maxed frustration (≥0.6) contributes ≥0.18', () => {
    // High answer_changes + navigation_backs + hesitation fraction → frustration clamped high
    const responses = Array.from({ length: 4 }, () =>
      makeResponse({
        answer_changes: 5,      // avgChanges=5 ≥3 → frustration += 0.3
        navigation_backs: 3,    // avgNavBacks=3 ≥2 → frustration += 0.2
        hesitation_ms: 8000,    // 8000/10000 = 0.8 >0.5 → frustration += 0.2
        response_time_ms: 10000,
        pause_count: 0,
        total_pause_ms: 0,
        word_count: 15,
        is_correct: true,
      }),
    );
    const signals = computeSessionSignals(responses);
    expect(signals.frustration).toBeGreaterThanOrEqual(0.6);
    const result = computeSessionRisk(responses);
    // frustration contribution = signals.frustration * 0.30 ≥ 0.6 * 0.30 = 0.18
    expect(result.score).toBeGreaterThanOrEqual(0.18);
    expect(result.factors).toContain('High frustration indicators');
  });

  it('attentionRisk weight 0.20: high pause fraction reduces attention and raises risk', () => {
    const responses = Array.from({ length: 3 }, () =>
      makeResponse({
        total_pause_ms: 5000,   // 50% of response time → pauseFraction=0.5 >0.4 → penalty 0.4
        response_time_ms: 10000,
        pause_count: 5,         // avgPauseCount=5 >4 → penalty +0.2 → total penalty 0.6
        answer_changes: 0,
        navigation_backs: 0,
        hesitation_ms: 0,
        is_correct: true,
      }),
    );
    const signals = computeSessionSignals(responses);
    expect(signals.attention).toBeLessThan(1);
    const attentionRisk = 1 - signals.attention;
    expect(attentionRisk).toBeGreaterThan(0);
    const result = computeSessionRisk(responses);
    // attentionRisk * 0.20 is included in score
    expect(result.score).toBeGreaterThanOrEqual(attentionRisk * 0.20 - 0.01);
  });

  it('velocityRisk weight 0.20: decelerating → 0.8 × 0.20 = 0.16 contribution', () => {
    // First half faster (5s) → second half slower (10s) → delta = (5-10)/5 = -1.0 < -0.2 → decelerating
    const responses = [
      makeResponse({ response_time_ms: 5000, is_correct: true }),
      makeResponse({ response_time_ms: 5000, is_correct: true }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
    ];
    const signals = computeSessionSignals(responses);
    expect(signals.velocityTrend).toBe('decelerating');
    const result = computeSessionRisk(responses);
    // decelerating velocityRisk=0.8 → 0.8 * 0.20 = 0.16
    expect(result.score).toBeGreaterThanOrEqual(0.16 - 0.01);
    expect(result.factors).toContain('Slowing learning pace');
  });

  it('velocityRisk weight 0.20: stable → 0.3 × 0.20 = 0.06 (when only this factor active)', () => {
    // Single response: no half-split possible → stable
    const responses = [makeResponse({ response_time_ms: 8000, is_correct: true })];
    const signals = computeSessionSignals(responses);
    expect(signals.velocityTrend).toBe('stable');
    // velocityRisk contribution = 0.3 * 0.20 = 0.06
    // score includes this plus other factors
    const result = computeSessionRisk(responses);
    expect(result.score).toBeGreaterThan(0); // real telemetry, not all-zero
  });

  it('velocityRisk weight 0.20: accelerating → 0.05 × 0.20 = 0.01', () => {
    // First half slow (10s) → second half fast (5s) → delta = (10-5)/10 = 0.5 >0.2 → accelerating
    const responses = [
      makeResponse({ response_time_ms: 10000, is_correct: true }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
      makeResponse({ response_time_ms: 5000, is_correct: true }),
      makeResponse({ response_time_ms: 5000, is_correct: true }),
    ];
    const signals = computeSessionSignals(responses);
    expect(signals.velocityTrend).toBe('accelerating');
  });

  it('errorRisk weight 0.15: conceptual pattern → 0.9 × freq × 0.15', () => {
    // Errors are 3× slower than correct → conceptual; errorFrequency = 0.5
    const responses = [
      makeResponse({ response_time_ms: 30000, is_correct: false }),
      makeResponse({ response_time_ms: 30000, is_correct: false }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
    ];
    const signals = computeSessionSignals(responses);
    expect(signals.errorPatternType).toBe('conceptual');
    expect(signals.errorFrequency).toBeCloseTo(0.5, 2);
    const result = computeSessionRisk(responses);
    // conceptual: errorRisk=0.9, freq=0.5 → 0.9*0.5*0.15 = 0.0675
    expect(result.score).toBeGreaterThan(0.06);
    expect(result.factors).toContain('Conceptual misunderstanding pattern');
  });

  it('errorRisk weight 0.15: careless pattern → 0.4 × freq × 0.15', () => {
    // Errors are much faster than correct → careless
    const responses = [
      makeResponse({ response_time_ms: 1000, is_correct: false }),
      makeResponse({ response_time_ms: 1000, is_correct: false }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
    ];
    const signals = computeSessionSignals(responses);
    expect(signals.errorPatternType).toBe('careless');
  });

  it('errorRisk weight 0.15: procedural pattern → 0.6 × freq × 0.15', () => {
    // Errors have high answer_changes but similar timing → procedural
    const responses = [
      makeResponse({ response_time_ms: 10000, is_correct: false, answer_changes: 3 }),
      makeResponse({ response_time_ms: 10000, is_correct: false, answer_changes: 3 }),
      makeResponse({ response_time_ms: 9500, is_correct: true, answer_changes: 0 }),
      makeResponse({ response_time_ms: 10500, is_correct: true, answer_changes: 0 }),
    ];
    const signals = computeSessionSignals(responses);
    expect(signals.errorPatternType).toBe('procedural');
  });

  it('calibration weight 0.10: poor calibration (>0.6 risk) triggers factor', () => {
    // Build a scenario where calibrationRisk > 0.6 → confidenceAccuracy < 0.4
    // Negative correlation: fast responses are wrong, slow are correct
    const responses = [
      makeResponse({ response_time_ms: 1000, is_correct: false }),
      makeResponse({ response_time_ms: 2000, is_correct: false }),
      makeResponse({ response_time_ms: 8000, is_correct: true }),
      makeResponse({ response_time_ms: 9000, is_correct: true }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
    ];
    const signals = computeSessionSignals(responses);
    const calibrationRisk = 1 - signals.confidenceAccuracy;
    const result = computeSessionRisk(responses);
    // calibrationRisk * 0.10 is included
    expect(result.score).toBeGreaterThan(calibrationRisk * 0.10 - 0.01);
  });

  it('engagement weight 0.05: low engagement (avgWords=0) keeps engagement low', () => {
    const responses = Array.from({ length: 3 }, () =>
      makeResponse({
        word_count: 0,
        answer_changes: 0,
        navigation_backs: 0,
        response_time_ms: 5000,
      }),
    );
    const signals = computeSessionSignals(responses);
    // engagement stays at 0.5 (neutral), engagementRisk = 0.5
    // contribution = 0.5 * 0.05 = 0.025
    expect(signals.engagement).toBe(0.5);
    const result = computeSessionRisk(responses);
    expect(result.score).toBeGreaterThan(0.02); // at minimum includes engagement contribution
  });

  it('score is always clamped to [0,1]', () => {
    // Worst-case: everything maxed
    const responses = Array.from({ length: 5 }, (_, i) =>
      makeResponse({
        response_time_ms: i < 3 ? 3000 : 30000, // decelerating
        hesitation_ms: 2500,
        answer_changes: 6,
        navigation_backs: 4,
        pause_count: 8,
        total_pause_ms: 2000,
        word_count: 0,
        is_correct: i < 3 ? false : true,
      }),
    );
    const result = computeSessionRisk(responses);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('known weights: manually verify weighted sum matches formula', () => {
    // Construct a case with known sub-scores and verify the ensemble arithmetic.
    // Use 4 responses: all correct, stable velocity, moderate frustration.
    // answer_changes=0, navigation_backs=0, hesitation=0 → frustration=0
    // pause_count=0, total_pause_ms=0 → attention=1
    // equal timing → stable
    // all correct → errorFrequency=0
    // ≥3 graded: all correct, equal times → correlation=0 → confidenceAccuracy=0.5
    // word_count=10 → engagement += 0.1 → engagement=0.6
    const responses = Array.from({ length: 4 }, () =>
      makeResponse({
        response_time_ms: 5000,
        hesitation_ms: 0,
        answer_changes: 0,
        navigation_backs: 0,
        pause_count: 0,
        total_pause_ms: 0,
        word_count: 10,
        is_correct: true,
      }),
    );
    const signals = computeSessionSignals(responses);
    expect(signals.frustration).toBe(0);
    expect(signals.attention).toBe(1);
    expect(signals.velocityTrend).toBe('stable');
    expect(signals.errorFrequency).toBe(0);
    expect(signals.confidenceAccuracy).toBe(0.5); // all equal times → range=0 → correlation=0
    expect(signals.engagement).toBe(0.6);

    // Manually compute expected score:
    // frustration   = 0 * 0.30                          = 0
    // attentionRisk = (1-1) * 0.20                       = 0
    // velocityRisk  = 0.3 * 0.20 (stable)               = 0.06
    // errorRisk     = 0.2 * 0 * 0.15 (other, freq=0)    = 0
    // calibration   = (1-0.5) * 0.10                    = 0.05
    // engagement    = (1-0.6) * 0.05                    = 0.02
    // total = 0.13 → round2 = 0.13
    const result = computeSessionRisk(responses);
    expect(result.score).toBeCloseTo(0.13, 2);
  });
});

// ─── computeSessionSignals unit tests ────────────────────────────────────────

describe('computeSessionSignals', () => {
  it('returns neutral signals for empty responses', () => {
    const s = computeSessionSignals([]);
    expect(s.frustration).toBe(0);
    expect(s.attention).toBe(1);
    expect(s.velocityTrend).toBe('stable');
    expect(s.errorPatternType).toBe('other');
    expect(s.errorFrequency).toBe(0);
    expect(s.confidenceAccuracy).toBe(0.5);
    expect(s.engagement).toBe(0.5);
  });

  it('detects careless errors when error responses are much faster than correct ones', () => {
    const responses = [
      makeResponse({ response_time_ms: 1000, is_correct: false }),
      makeResponse({ response_time_ms: 1000, is_correct: false }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
    ];
    const s = computeSessionSignals(responses);
    expect(s.errorPatternType).toBe('careless');
  });

  it('detects procedural errors when errors have high answer_changes', () => {
    const responses = [
      makeResponse({ response_time_ms: 10000, is_correct: false, answer_changes: 3 }),
      makeResponse({ response_time_ms: 10000, is_correct: false, answer_changes: 3 }),
      makeResponse({ response_time_ms: 9000, is_correct: true, answer_changes: 0 }),
      makeResponse({ response_time_ms: 10500, is_correct: true, answer_changes: 0 }),
    ];
    const s = computeSessionSignals(responses);
    expect(s.errorPatternType).toBe('procedural');
  });

  it('engagement increases with higher word_count', () => {
    const low = computeSessionSignals([makeResponse({ word_count: 2 })]);
    const high = computeSessionSignals([makeResponse({ word_count: 30 })]);
    expect(high.engagement).toBeGreaterThan(low.engagement);
  });

  it('frustration sums correctly with all three indicators', () => {
    // answer_changes=5 → +0.3, navigation_backs=3 → +0.2, hesitation=0.8 → +0.2 = 0.7
    const s = computeSessionSignals([
      makeResponse({
        answer_changes: 5,
        navigation_backs: 3,
        hesitation_ms: 8000,
        response_time_ms: 10000,
      }),
    ]);
    expect(s.frustration).toBeCloseTo(0.7, 1);
  });

  it('attention penalty applied correctly for high pause fraction and pause count', () => {
    // pauseFraction = 5000/10000 = 0.5 > 0.4 → penalty 0.4; pause_count=5 >4 → +0.2 → total 0.6
    const s = computeSessionSignals([
      makeResponse({
        total_pause_ms: 5000,
        response_time_ms: 10000,
        pause_count: 5,
      }),
    ]);
    // attention = 1 - 0.6 = 0.4
    expect(s.attention).toBeCloseTo(0.4, 1);
  });
});

// ─── Factor string thresholds (V1 verbatim) ──────────────────────────────────

describe('computeSessionRisk — factor string thresholds', () => {
  it('"High frustration indicators" fires when frustration > 0.6', () => {
    const responses = Array.from({ length: 3 }, () =>
      makeResponse({ answer_changes: 5, navigation_backs: 3, hesitation_ms: 8000, response_time_ms: 10000 }),
    );
    const result = computeSessionRisk(responses);
    expect(result.factors).toContain('High frustration indicators');
  });

  it('"Low attention / frequent distraction" fires when attentionRisk > 0.5', () => {
    // attention < 0.5 → attentionRisk > 0.5
    const responses = Array.from({ length: 3 }, () =>
      makeResponse({ total_pause_ms: 6000, response_time_ms: 10000, pause_count: 6 }),
    );
    const signals = computeSessionSignals(responses);
    expect(1 - signals.attention).toBeGreaterThan(0.5);
    const result = computeSessionRisk(responses);
    expect(result.factors).toContain('Low attention / frequent distraction');
  });

  it('"Slowing learning pace" fires for decelerating velocity', () => {
    const responses = [
      makeResponse({ response_time_ms: 5000 }),
      makeResponse({ response_time_ms: 5000 }),
      makeResponse({ response_time_ms: 10000 }),
      makeResponse({ response_time_ms: 10000 }),
    ];
    const result = computeSessionRisk(responses);
    expect(result.factors).toContain('Slowing learning pace');
  });

  it('"Conceptual misunderstanding pattern" fires for conceptual + freq > 0.4', () => {
    const responses = [
      makeResponse({ response_time_ms: 30000, is_correct: false }),
      makeResponse({ response_time_ms: 30000, is_correct: false }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
      makeResponse({ response_time_ms: 10000, is_correct: true }),
    ];
    const result = computeSessionRisk(responses);
    expect(result.factors).toContain('Conceptual misunderstanding pattern');
  });

  it('"Passive engagement" fires when engagement < 0.3', () => {
    // engagement: no word_count, excessive nav_backs and pause_count
    const responses = Array.from({ length: 3 }, () =>
      makeResponse({
        word_count: 0,
        navigation_backs: 4,    // avgNavBacks=4 ≥3 → -0.15
        pause_count: 7,         // >5 → -0.1
        response_time_ms: 5000,
        total_pause_ms: 0,
      }),
    );
    const signals = computeSessionSignals(responses);
    expect(signals.engagement).toBeLessThan(0.3);
    const result = computeSessionRisk(responses);
    expect(result.factors).toContain('Passive engagement');
  });
});
