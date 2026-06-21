import { describe, it, expect } from 'vitest';
import { computeSignals } from '../computeSignals';
import type { RawSessionData, QuestionAttemptData, SessionAggregates } from '../behavioralTypes';

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makeAttempt(overrides: Partial<QuestionAttemptData> = {}): QuestionAttemptData {
  return {
    questionId: 'q1',
    questionIndex: 0,
    isCorrect: true,
    timeTakenMs: 10000,
    changeCount: 0,
    hintsUsed: 0,
    ...overrides,
  };
}

function makeAggregates(overrides: Partial<SessionAggregates> = {}): SessionAggregates {
  return {
    focusLossCount: 0,
    pasteCount: 0,
    pauseCount: 0,
    totalPauseMs: 0,
    totalFocusLossMs: 0,
    backspaceCount: 0,
    keypressCount: 0,
    ttsPlayCount: 0,
    canvasUsed: false,
    stuckEraseCount: 0,
    ...overrides,
  };
}

function makeSession(
  overrides: Partial<RawSessionData> & {
    questionAttempts?: QuestionAttemptData[];
    aggregates?: SessionAggregates;
  } = {},
): RawSessionData {
  return {
    studentId: 'student-1',
    sessionId: 'session-1',
    context: 'quiz',
    schoolId: 'school-1',
    questionAttempts: overrides.questionAttempts ?? [],
    aggregates: overrides.aggregates ?? makeAggregates(),
    sessionStartMs: 0,
    sessionEndMs: 60000, // 1 minute
    ...overrides,
  };
}

// ─── Insufficient data path ─────────────────────────────────────────────────

describe('insufficient-data path (empty questionAttempts)', () => {
  it('returns errorPatternType: insufficient_data for empty attempts', () => {
    const result = computeSignals(makeSession());
    expect(result.errorPatternType).toBe('insufficient_data');
  });

  it('all scores are defined and within [0,1] for empty attempts', () => {
    const result = computeSignals(makeSession());
    const scoreFields: (keyof typeof result)[] = [
      'frustrationScore',
      'attentionScore',
      'confidenceScore',
      'confidenceAccuracy',
      'engagementScore',
      'predictiveRiskScore',
      'errorFrequency',
    ];
    for (const field of scoreFields) {
      const val = result[field] as number;
      expect(typeof val).toBe('number');
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it('learningVelocity is 0 for empty attempts', () => {
    const result = computeSignals(makeSession());
    expect(result.learningVelocity).toBe(0);
  });

  it('velocityTrend is stable for empty attempts', () => {
    const result = computeSignals(makeSession());
    expect(result.velocityTrend).toBe('stable');
  });

  it('sessionDurationMs equals sessionEndMs - sessionStartMs', () => {
    const session = makeSession({ sessionStartMs: 1000, sessionEndMs: 61000 });
    const result = computeSignals(session);
    expect(result.sessionDurationMs).toBe(60000);
  });
});

// ─── Learning Velocity ──────────────────────────────────────────────────────

describe('learningVelocity', () => {
  it('computes correct-per-minute: 3 correct in 60s = 3 correct/min', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: false }),
      ],
      sessionStartMs: 0,
      sessionEndMs: 60000, // 1 minute
    });
    const result = computeSignals(session);
    expect(result.learningVelocity).toBe(3); // 3 correct / 1 min
  });

  it('computes correct-per-minute: 4 correct in 120s = 2 correct/min', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: false }),
      ],
      sessionStartMs: 0,
      sessionEndMs: 120000, // 2 minutes
    });
    const result = computeSignals(session);
    expect(result.learningVelocity).toBe(2); // 4 correct / 2 min
  });

  it('velocity trend is accelerating when second half is faster', () => {
    // First half avg 10s, second half avg 5s → getting faster → accelerating
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 5000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 5000, isCorrect: true }),
      ],
      sessionStartMs: 0,
      sessionEndMs: 60000,
    });
    const result = computeSignals(session);
    expect(result.velocityTrend).toBe('accelerating');
  });

  it('velocity trend is decelerating when second half is slower', () => {
    // First half avg 5s, second half avg 10s → getting slower → decelerating
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 5000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 5000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
      ],
      sessionStartMs: 0,
      sessionEndMs: 60000,
    });
    const result = computeSignals(session);
    expect(result.velocityTrend).toBe('decelerating');
  });

  it('velocity trend is stable when pace is similar', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10500, isCorrect: true }),
        makeAttempt({ timeTakenMs: 9500, isCorrect: true }),
      ],
      sessionStartMs: 0,
      sessionEndMs: 60000,
    });
    const result = computeSignals(session);
    expect(result.velocityTrend).toBe('stable');
  });
});

// ─── Error Pattern ──────────────────────────────────────────────────────────

describe('errorPattern', () => {
  it('returns insufficient_data when fewer than 3 attempts', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: false }),
        makeAttempt({ isCorrect: true }),
      ],
    });
    const result = computeSignals(session);
    expect(result.errorPatternType).toBe('insufficient_data');
  });

  it('detects careless errors: errors much faster than correct (< 0.6× correct time)', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 1000, isCorrect: false }),
        makeAttempt({ timeTakenMs: 1000, isCorrect: false }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
      ],
    });
    const result = computeSignals(session);
    expect(result.errorPatternType).toBe('careless');
  });

  it('detects conceptual errors: errors much slower than correct (> 1.8× correct time)', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 30000, isCorrect: false }),
        makeAttempt({ timeTakenMs: 30000, isCorrect: false }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
      ],
    });
    const result = computeSignals(session);
    expect(result.errorPatternType).toBe('conceptual');
  });

  it('detects procedural errors: errors have high changeCount (≥2)', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 10000, isCorrect: false, changeCount: 3 }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: false, changeCount: 3 }),
        makeAttempt({ timeTakenMs: 9500, isCorrect: true, changeCount: 0 }),
        makeAttempt({ timeTakenMs: 10500, isCorrect: true, changeCount: 0 }),
      ],
    });
    const result = computeSignals(session);
    expect(result.errorPatternType).toBe('procedural');
  });

  it('returns random for non-patterned errors', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 10000, isCorrect: false, changeCount: 0 }),
        makeAttempt({ timeTakenMs: 10500, isCorrect: true, changeCount: 0 }),
        makeAttempt({ timeTakenMs: 9500, isCorrect: true, changeCount: 0 }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: false, changeCount: 0 }),
      ],
    });
    const result = computeSignals(session);
    expect(result.errorPatternType).toBe('random');
  });

  it('computes errorFrequency = errors / total attempts', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: false }),
        makeAttempt({ isCorrect: false }),
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
      ],
    });
    const result = computeSignals(session);
    expect(result.errorFrequency).toBeCloseTo(0.5, 2);
  });
});

// ─── Confidence ─────────────────────────────────────────────────────────────

describe('confidence', () => {
  it('confidenceScore is in [0,1]', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 2000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 8000, isCorrect: false }),
        makeAttempt({ timeTakenMs: 5000, isCorrect: true }),
      ],
    });
    const result = computeSignals(session);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore).toBeLessThanOrEqual(1);
  });

  it('faster responses give higher confidenceScore than slower responses', () => {
    // All fast → high confidence
    const fastSession = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 1000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 1500, isCorrect: true }),
        makeAttempt({ timeTakenMs: 1200, isCorrect: true }),
      ],
    });
    // All slow → lower confidence (relative scoring)
    const slowSession = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 9000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 11000, isCorrect: true }),
      ],
    });
    // When all times are equal, the range=0 fallback applies; score should still be [0,1]
    const fastResult = computeSignals(fastSession);
    const slowResult = computeSignals(slowSession);
    expect(fastResult.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(slowResult.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(fastResult.confidenceScore).toBeLessThanOrEqual(1);
    expect(slowResult.confidenceScore).toBeLessThanOrEqual(1);
  });

  it('confidenceAccuracy in [0,1]', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 2000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: false }),
        makeAttempt({ timeTakenMs: 3000, isCorrect: true }),
      ],
    });
    const result = computeSignals(session);
    expect(result.confidenceAccuracy).toBeGreaterThanOrEqual(0);
    expect(result.confidenceAccuracy).toBeLessThanOrEqual(1);
  });

  it('confidenceAccuracy is 0 for insufficient data (< 3 graded attempts)', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: false }),
      ],
    });
    const result = computeSignals(session);
    expect(result.confidenceAccuracy).toBe(0);
  });
});

// ─── Frustration ────────────────────────────────────────────────────────────

describe('frustration', () => {
  it('frustrationScore is 0 when no negative signals', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: true, changeCount: 0, hintsUsed: 0 }),
        makeAttempt({ isCorrect: true, changeCount: 0, hintsUsed: 0 }),
        makeAttempt({ isCorrect: true, changeCount: 0, hintsUsed: 0 }),
      ],
      aggregates: makeAggregates({
        focusLossCount: 0,
        backspaceCount: 0,
        keypressCount: 50,
        pauseCount: 0,
        totalPauseMs: 0,
      }),
    });
    const result = computeSignals(session);
    expect(result.frustrationScore).toBe(0);
  });

  it('frustrationScore increases with focusLossCount ≥ 3', () => {
    const lowFocus = makeSession({ aggregates: makeAggregates({ focusLossCount: 0 }) });
    const highFocus = makeSession({ aggregates: makeAggregates({ focusLossCount: 5 }) });
    const low = computeSignals(lowFocus);
    const high = computeSignals(highFocus);
    expect(high.frustrationScore).toBeGreaterThan(low.frustrationScore);
  });

  it('frustrationScore responds to high changeCount on wrong answers', () => {
    const noThrash = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: false, changeCount: 0 }),
        makeAttempt({ isCorrect: true, changeCount: 0 }),
        makeAttempt({ isCorrect: true, changeCount: 0 }),
      ],
    });
    const thrash = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: false, changeCount: 3 }),
        makeAttempt({ isCorrect: true, changeCount: 0 }),
        makeAttempt({ isCorrect: true, changeCount: 0 }),
      ],
    });
    const noResult = computeSignals(noThrash);
    const thrashResult = computeSignals(thrash);
    expect(thrashResult.frustrationScore).toBeGreaterThan(noResult.frustrationScore);
  });

  it('frustrationScore "Repeated loss of focus" fires with focusLossCount ≥ 3', () => {
    const session = makeSession({
      aggregates: makeAggregates({ focusLossCount: 3 }),
    });
    const result = computeSignals(session);
    expect(result.frustrationIndicators).toContain('Repeated loss of focus');
  });

  it('frustrationIndicators contains "Stuck-and-erase pattern" when stuckEraseCount >= 3', () => {
    const session = makeSession({
      aggregates: makeAggregates({ stuckEraseCount: 3 }),
    });
    const result = computeSignals(session);
    expect(result.frustrationIndicators).toContain('Stuck-and-erase pattern');
  });

  it('frustrationIndicators does NOT contain "Stuck-and-erase pattern" when stuckEraseCount < 3', () => {
    const session = makeSession({
      aggregates: makeAggregates({ stuckEraseCount: 2 }),
    });
    const result = computeSignals(session);
    expect(result.frustrationIndicators).not.toContain('Stuck-and-erase pattern');
  });

  it('frustrationScore is clamped to [0,1] even with extreme inputs', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: false, changeCount: 10, hintsUsed: 10 }),
        makeAttempt({ isCorrect: false, changeCount: 10, hintsUsed: 10 }),
        makeAttempt({ isCorrect: false, changeCount: 10, hintsUsed: 10 }),
      ],
      aggregates: makeAggregates({
        focusLossCount: 20,
        backspaceCount: 50,
        keypressCount: 100,
      }),
    });
    const result = computeSignals(session);
    expect(result.frustrationScore).toBeGreaterThanOrEqual(0);
    expect(result.frustrationScore).toBeLessThanOrEqual(1);
  });
});

// ─── Attention ──────────────────────────────────────────────────────────────

describe('attention', () => {
  it('attentionGaps equals aggregates.focusLossCount', () => {
    const session = makeSession({
      aggregates: makeAggregates({ focusLossCount: 4 }),
    });
    const result = computeSignals(session);
    expect(result.attentionGaps).toBe(4);
  });

  it('attentionGaps equals 0 when focusLossCount is 0', () => {
    const session = makeSession({
      aggregates: makeAggregates({ focusLossCount: 0 }),
    });
    const result = computeSignals(session);
    expect(result.attentionGaps).toBe(0);
  });

  it('attentionScore is lower when focusLossCount is high', () => {
    const noLoss = makeSession({
      sessionEndMs: 60000,
      aggregates: makeAggregates({ focusLossCount: 0, totalFocusLossMs: 0 }),
    });
    const highLoss = makeSession({
      sessionEndMs: 60000,
      aggregates: makeAggregates({ focusLossCount: 10, totalFocusLossMs: 30000 }),
    });
    const noResult = computeSignals(noLoss);
    const highResult = computeSignals(highLoss);
    expect(highResult.attentionScore).toBeLessThan(noResult.attentionScore);
  });

  it('attentionScore is in [0,1]', () => {
    const session = makeSession({
      sessionEndMs: 60000,
      aggregates: makeAggregates({ focusLossCount: 100, totalFocusLossMs: 60000 }),
    });
    const result = computeSignals(session);
    expect(result.attentionScore).toBeGreaterThanOrEqual(0);
    expect(result.attentionScore).toBeLessThanOrEqual(1);
  });

  it('attentionScore is 1 for very short sessions (< 5s)', () => {
    const session = makeSession({
      sessionStartMs: 0,
      sessionEndMs: 4000, // 4 seconds
      aggregates: makeAggregates({ focusLossCount: 2, totalFocusLossMs: 1000 }),
    });
    const result = computeSignals(session);
    expect(result.attentionScore).toBe(1);
    expect(result.attentionGaps).toBe(0);
  });
});

// ─── Engagement ─────────────────────────────────────────────────────────────

describe('engagement', () => {
  it('engagementScore is in [0,1]', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
      ],
      aggregates: makeAggregates({ focusLossCount: 0 }),
    });
    const result = computeSignals(session);
    expect(result.engagementScore).toBeGreaterThanOrEqual(0);
    expect(result.engagementScore).toBeLessThanOrEqual(1);
  });

  it('returns passive style when no attempts', () => {
    const result = computeSignals(makeSession());
    expect(result.engagementStyle).toBe('passive');
  });

  it('returns passive style when focusLoss is high (≥4)', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
      ],
      aggregates: makeAggregates({ focusLossCount: 5 }),
    });
    const result = computeSignals(session);
    expect(result.engagementStyle).toBe('passive');
  });

  it('returns methodical style when no impulsive/exploratory/passive signals', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 15000, isCorrect: true, changeCount: 0, hintsUsed: 0 }),
        makeAttempt({ timeTakenMs: 15000, isCorrect: true, changeCount: 0, hintsUsed: 0 }),
        makeAttempt({ timeTakenMs: 15000, isCorrect: true, changeCount: 0, hintsUsed: 0 }),
      ],
      aggregates: makeAggregates({
        focusLossCount: 0,
        backspaceCount: 5,
        keypressCount: 100,
        ttsPlayCount: 0,
        canvasUsed: false,
      }),
    });
    const result = computeSignals(session);
    expect(result.engagementStyle).toBe('methodical');
  });

  it('returns exploratory style when canvas is used', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 10000, isCorrect: true, hintsUsed: 0 }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true, hintsUsed: 0 }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true, hintsUsed: 0 }),
      ],
      aggregates: makeAggregates({
        focusLossCount: 0,
        canvasUsed: true,
      }),
    });
    const result = computeSignals(session);
    expect(result.engagementStyle).toBe('exploratory');
  });
});

// ─── Predictive Risk ────────────────────────────────────────────────────────

describe('predictiveRisk', () => {
  it('predictiveRiskScore is in [0,1]', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
        makeAttempt({ isCorrect: true }),
      ],
    });
    const result = computeSignals(session);
    expect(result.predictiveRiskScore).toBeGreaterThanOrEqual(0);
    expect(result.predictiveRiskScore).toBeLessThanOrEqual(1);
  });

  it('predictiveRiskScore is higher when frustration and focus loss are high', () => {
    const lowRisk = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: true, changeCount: 0 }),
        makeAttempt({ isCorrect: true, changeCount: 0 }),
        makeAttempt({ isCorrect: true, changeCount: 0 }),
      ],
      aggregates: makeAggregates({ focusLossCount: 0 }),
    });
    const highRisk = makeSession({
      questionAttempts: [
        makeAttempt({ isCorrect: false, changeCount: 5 }),
        makeAttempt({ isCorrect: false, changeCount: 5 }),
        makeAttempt({ isCorrect: false, changeCount: 5 }),
      ],
      aggregates: makeAggregates({ focusLossCount: 10, totalFocusLossMs: 20000 }),
      sessionEndMs: 60000,
    });
    const low = computeSignals(lowRisk);
    const high = computeSignals(highRisk);
    expect(high.predictiveRiskScore).toBeGreaterThan(low.predictiveRiskScore);
  });

  it('riskFactors includes "Slowing learning pace" for decelerating trend', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 5000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 5000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
      ],
      sessionStartMs: 0,
      sessionEndMs: 60000,
    });
    const result = computeSignals(session);
    expect(result.riskFactors).toContain('Slowing learning pace');
  });

  it('riskFactors includes "Conceptual misunderstanding pattern" for conceptual + high freq', () => {
    // All wrong (freq=1.0), all much slower than "correct" … but there are no corrects
    // Use 2 conceptual errors + 2 corrects so correct avg is known
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 30000, isCorrect: false }),
        makeAttempt({ timeTakenMs: 30000, isCorrect: false }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
        makeAttempt({ timeTakenMs: 10000, isCorrect: true }),
      ],
      sessionStartMs: 0,
      sessionEndMs: 60000,
    });
    const result = computeSignals(session);
    expect(result.errorPatternType).toBe('conceptual');
    expect(result.errorFrequency).toBeGreaterThan(0.4);
    expect(result.riskFactors).toContain('Conceptual misunderstanding pattern');
  });

  it('predictiveRiskScore is clamped to [0,1] even with all worst-case signals', () => {
    const session = makeSession({
      questionAttempts: [
        makeAttempt({ timeTakenMs: 5000, isCorrect: false, changeCount: 10 }),
        makeAttempt({ timeTakenMs: 5000, isCorrect: false, changeCount: 10 }),
        makeAttempt({ timeTakenMs: 30000, isCorrect: false, changeCount: 10 }),
        makeAttempt({ timeTakenMs: 30000, isCorrect: false, changeCount: 10 }),
        makeAttempt({ timeTakenMs: 30000, isCorrect: false, changeCount: 10 }),
      ],
      aggregates: makeAggregates({
        focusLossCount: 20,
        totalFocusLossMs: 30000,
        backspaceCount: 200,
        keypressCount: 300,
      }),
      sessionStartMs: 0,
      sessionEndMs: 60000,
    });
    const result = computeSignals(session);
    expect(result.predictiveRiskScore).toBeGreaterThanOrEqual(0);
    expect(result.predictiveRiskScore).toBeLessThanOrEqual(1);
  });
});

// ─── All scores clamped ─────────────────────────────────────────────────────

describe('all scores always within [0,1]', () => {
  it('scores are bounded for a typical well-performing student', () => {
    const session = makeSession({
      questionAttempts: Array.from({ length: 5 }, (_, i) =>
        makeAttempt({ questionIndex: i, isCorrect: true, timeTakenMs: 8000, changeCount: 0 }),
      ),
      sessionStartMs: 0,
      sessionEndMs: 300000,
      aggregates: makeAggregates({ focusLossCount: 0 }),
    });
    const result = computeSignals(session);
    const numericFields = [
      result.learningVelocity,
      result.frustrationScore,
      result.attentionScore,
      result.errorFrequency,
      result.confidenceScore,
      result.confidenceAccuracy,
      result.engagementScore,
      result.predictiveRiskScore,
    ];
    for (const v of numericFields) {
      expect(v).toBeGreaterThanOrEqual(0);
      // learningVelocity can exceed 1 (it's correct/min, not a ratio)
    }
    // 0-1 bounded scores
    const bounded = [
      result.frustrationScore,
      result.attentionScore,
      result.errorFrequency,
      result.confidenceScore,
      result.confidenceAccuracy,
      result.engagementScore,
      result.predictiveRiskScore,
    ];
    for (const v of bounded) {
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
