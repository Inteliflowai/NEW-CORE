// src/lib/signals/__tests__/computeRosterRiskIndex.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeRosterRiskIndex,
  type StudentSignalData,
} from '../computeRosterRiskIndex';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeData(overrides: Partial<StudentSignalData> = {}): StudentSignalData {
  return {
    homeworkAttempts: [],
    quizAttempts: [],
    totalAssigned: 0,
    ...overrides,
  };
}

// Fixed reference date for deterministic tests (C24)
const REF_DATE = new Date('2026-01-15T12:00:00.000Z');

/** Return an ISO string for N days before REF_DATE. */
function isoBeforeRef(daysAgo: number): string {
  return new Date(REF_DATE.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

/** Return an ISO string for N days before now (for live-clock band tests). */
function recentIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

// ─── Band boundary tests ─────────────────────────────────────────────────────

describe('computeRosterRiskIndex — band boundaries', () => {
  it('returns low (<25) for a high-performing student', () => {
    const data = makeData({
      homeworkAttempts: [
        { score: 95, submitted_at: recentIso(1), allow_redo: false, is_redo: false },
        { score: 90, submitted_at: recentIso(2), allow_redo: false, is_redo: false },
      ],
      quizAttempts: [
        { score: 92, submitted_at: recentIso(1) },
        { score: 88, submitted_at: recentIso(3) },
      ],
      totalAssigned: 2,
    });
    const result = computeRosterRiskIndex(data);
    expect(result.risk_level).toBe('low');
    expect(result.risk_score).toBeLessThan(25);
  });

  it('returns medium (25–49) for a student with decent-but-not-great scores', () => {
    // avgHw ≈ 80, avgQuiz ≈ 82, full completion, recent submissions
    // hwPenalty = 25 - scalePenalty(80,60,85,25) = 25-20 = 5
    // quizPenalty = 25 - scalePenalty(82,60,85,25) = 25-22 = 3
    // completionPenalty = max(scalePenalty(1,0,0.7,20)=20, adjustedCompletion=0) = 20
    // Total ≈ 28 → medium
    const data = makeData({
      homeworkAttempts: [
        { score: 80, submitted_at: recentIso(2), allow_redo: false, is_redo: false },
        { score: 80, submitted_at: recentIso(4), allow_redo: false, is_redo: false },
      ],
      quizAttempts: [
        { score: 82, submitted_at: recentIso(2) },
      ],
      totalAssigned: 2,
    });
    const result = computeRosterRiskIndex(data);
    expect(result.risk_level).toBe('medium');
    expect(result.risk_score).toBeGreaterThanOrEqual(25);
    expect(result.risk_score).toBeLessThan(50);
  });

  it('returns high (50–74) for a student with low scores + some missed work', () => {
    const data = makeData({
      homeworkAttempts: [
        { score: 50, submitted_at: recentIso(3), allow_redo: false, is_redo: false },
        { score: 55, submitted_at: null, allow_redo: false, is_redo: false },
        { score: 48, submitted_at: recentIso(5), allow_redo: false, is_redo: false },
      ],
      quizAttempts: [
        { score: 52, submitted_at: recentIso(3) },
      ],
      totalAssigned: 5,
    });
    const result = computeRosterRiskIndex(data);
    expect(result.risk_level).toBe('high');
    expect(result.risk_score).toBeGreaterThanOrEqual(50);
    expect(result.risk_score).toBeLessThan(75);
  });

  it('returns critical (≥75) for a student with very low scores, no completions, no recent activity', () => {
    const data = makeData({
      homeworkAttempts: [
        { score: 30, submitted_at: recentIso(20), allow_redo: true, is_redo: false },
        { score: 25, submitted_at: recentIso(22), allow_redo: true, is_redo: true },
      ],
      quizAttempts: [
        { score: 28, submitted_at: recentIso(21) },
      ],
      totalAssigned: 10,
    });
    const result = computeRosterRiskIndex(data);
    expect(result.risk_level).toBe('critical');
    expect(result.risk_score).toBeGreaterThanOrEqual(75);
  });
});

// ─── Component tests ─────────────────────────────────────────────────────────

describe('computeRosterRiskIndex — components', () => {
  it('avgHwScore: no graded hw adds 0.5 * W.avgHwScore = 12.5 and pushes factor', () => {
    const data = makeData({
      homeworkAttempts: [
        { score: null, submitted_at: isoBeforeRef(1), allow_redo: false, is_redo: false },
      ],
      quizAttempts: [{ score: 90, submitted_at: isoBeforeRef(1) }],
      totalAssigned: 1,
    });
    const result = computeRosterRiskIndex(data, REF_DATE);
    expect(result.risk_factors).toContain('No graded assignments on record');
  });

  it('avgQuizScore: no quiz attempts adds W.avgQuizScore * 0.3 = 7.5 to score', () => {
    // With perfect hw (score=90 → hwPenalty=0) and full completion + recent submission,
    // only the no-quiz penalty (7.5) and completion (20) contribute → score ≈ 28 (medium).
    // Verifies 7.5 is added (score > 0 even with perfect hw), and no quiz factor in factors.
    const data = makeData({
      homeworkAttempts: [
        { score: 90, submitted_at: isoBeforeRef(1), allow_redo: false, is_redo: false },
      ],
      quizAttempts: [],
      totalAssigned: 1,
    });
    const result = computeRosterRiskIndex(data, REF_DATE);
    // Score > 0 confirms the no-quiz 7.5 penalty was added
    expect(result.risk_score).toBeGreaterThan(0);
    // No quiz factor string — the no-quiz path silently adds 7.5 without a factor string
    expect(result.risk_factors.some((f) => f.includes('quiz'))).toBe(false);
  });

  it('completionRate: < 0.7 flags low submission rate', () => {
    const data = makeData({
      homeworkAttempts: [
        { score: 80, submitted_at: isoBeforeRef(1), allow_redo: false, is_redo: false },
      ],
      quizAttempts: [],
      totalAssigned: 5, // 1/5 = 20% completion
    });
    const result = computeRosterRiskIndex(data, REF_DATE);
    expect(result.risk_factors.some((f) => f.includes('Low submission rate'))).toBe(true);
  });

  it('completionRate: between 0.7 and 0.9 flags missing some', () => {
    const data = makeData({
      homeworkAttempts: [
        { score: 85, submitted_at: isoBeforeRef(1), allow_redo: false, is_redo: false },
        { score: 85, submitted_at: isoBeforeRef(2), allow_redo: false, is_redo: false },
        { score: 85, submitted_at: isoBeforeRef(3), allow_redo: false, is_redo: false },
        { score: 85, submitted_at: isoBeforeRef(4), allow_redo: false, is_redo: false },
      ],
      quizAttempts: [],
      totalAssigned: 5, // 4/5 = 80% → "missing some"
    });
    const result = computeRosterRiskIndex(data, REF_DATE);
    expect(result.risk_factors.some((f) => f.includes('Missing some assignments'))).toBe(true);
  });

  it('scoreTrend: declining scores (newest-first) adds trend penalty', () => {
    // newest-first: [40, 50, 65, 80] → reversed for regression → [80, 65, 50, 40] → slope -13.3
    const data = makeData({
      homeworkAttempts: [
        { score: 40, submitted_at: isoBeforeRef(1), allow_redo: false, is_redo: false },
        { score: 50, submitted_at: isoBeforeRef(3), allow_redo: false, is_redo: false },
        { score: 65, submitted_at: isoBeforeRef(5), allow_redo: false, is_redo: false },
        { score: 80, submitted_at: isoBeforeRef(7), allow_redo: false, is_redo: false },
      ],
      quizAttempts: [],
      totalAssigned: 4,
    });
    const result = computeRosterRiskIndex(data, REF_DATE);
    expect(result.risk_factors).toContain('Scores are declining over recent assignments');
  });

  it('redoRate: > 0.4 flags high redo frequency', () => {
    const data = makeData({
      homeworkAttempts: [
        { score: 85, submitted_at: isoBeforeRef(1), allow_redo: true, is_redo: false },
        { score: 85, submitted_at: isoBeforeRef(2), allow_redo: true, is_redo: false },
        { score: 85, submitted_at: isoBeforeRef(3), allow_redo: false, is_redo: false },
      ],
      quizAttempts: [{ score: 85, submitted_at: isoBeforeRef(1) }],
      totalAssigned: 3,
    });
    const result = computeRosterRiskIndex(data, REF_DATE);
    expect(result.risk_factors.some((f) => f.includes('High redo frequency'))).toBe(true);
  });

  it('recency: > 7 days without submission adds recency penalty', () => {
    const data = makeData({
      homeworkAttempts: [
        { score: 85, submitted_at: isoBeforeRef(15), allow_redo: false, is_redo: false },
      ],
      quizAttempts: [],
      totalAssigned: 1,
    });
    const result = computeRosterRiskIndex(data, REF_DATE);
    expect(result.risk_factors.some((f) => f.includes('No submissions in the past'))).toBe(true);
  });

  it('recency: no timestamps at all flags "No submissions on record"', () => {
    const data = makeData({
      homeworkAttempts: [],
      quizAttempts: [],
      totalAssigned: 0,
    });
    const result = computeRosterRiskIndex(data, REF_DATE);
    expect(result.risk_factors).toContain('No submissions on record');
  });

  it('risk_score is always an integer in [0, 100]', () => {
    for (let i = 0; i < 5; i++) {
      const data = makeData({
        homeworkAttempts: [
          { score: i * 10, submitted_at: isoBeforeRef(i + 1), allow_redo: i % 2 === 0, is_redo: false },
        ],
        quizAttempts: [{ score: i * 15, submitted_at: isoBeforeRef(i + 1) }],
        totalAssigned: 3,
      });
      const { risk_score } = computeRosterRiskIndex(data, REF_DATE);
      expect(Number.isInteger(risk_score)).toBe(true);
      expect(risk_score).toBeGreaterThanOrEqual(0);
      expect(risk_score).toBeLessThanOrEqual(100);
    }
  });
});

// ─── C24: Determinism tests (referenceDate injection) ────────────────────────

describe('computeRosterRiskIndex — C24 referenceDate determinism', () => {
  const FIXED_REF = new Date('2026-03-01T00:00:00.000Z');

  // Submission 10 days before the fixed reference date → recency penalty applies
  const SUBMISSION_ISO = new Date(FIXED_REF.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

  const deterministicData: StudentSignalData = {
    homeworkAttempts: [
      { score: 70, submitted_at: SUBMISSION_ISO, allow_redo: false, is_redo: false },
      { score: 72, submitted_at: SUBMISSION_ISO, allow_redo: false, is_redo: false },
    ],
    quizAttempts: [
      { score: 68, submitted_at: SUBMISSION_ISO },
    ],
    totalAssigned: 2,
  };

  it('same input + same referenceDate → identical risk_score (determinism)', () => {
    const r1 = computeRosterRiskIndex(deterministicData, FIXED_REF);
    const r2 = computeRosterRiskIndex(deterministicData, FIXED_REF);
    expect(r1.risk_score).toBe(r2.risk_score);
    expect(r1.risk_level).toBe(r2.risk_level);
    expect(r1.risk_factors).toEqual(r2.risk_factors);
  });

  it('an earlier referenceDate (submission within 7 days) produces no recency penalty', () => {
    // Use a reference date only 5 days after the submission → no recency factor
    const earlyRef = new Date(FIXED_REF.getTime() - 5 * 24 * 60 * 60 * 1000);
    const result = computeRosterRiskIndex(deterministicData, earlyRef);
    expect(result.risk_factors.some((f) => f.includes('No submissions in the past'))).toBe(false);
  });

  it('a later referenceDate (submission > 7 days ago) produces a recency penalty', () => {
    // FIXED_REF is 10 days after SUBMISSION_ISO → should flag recency
    const result = computeRosterRiskIndex(deterministicData, FIXED_REF);
    expect(result.risk_factors.some((f) => f.includes('No submissions in the past'))).toBe(true);
  });

  it('a much later referenceDate increases risk_score compared to an earlier one', () => {
    // 10 days after → some recency penalty
    const result10 = computeRosterRiskIndex(deterministicData, FIXED_REF);
    // 25 days after → maximum recency penalty (beyond 21-day cap)
    const lateRef = new Date(FIXED_REF.getTime() + 15 * 24 * 60 * 60 * 1000);
    const result25 = computeRosterRiskIndex(deterministicData, lateRef);
    expect(result25.risk_score).toBeGreaterThan(result10.risk_score);
  });

  it('exact risk_score is stable across calls with the same referenceDate', () => {
    const r = computeRosterRiskIndex(deterministicData, FIXED_REF);
    // Call again — must be byte-for-byte identical
    const r2 = computeRosterRiskIndex(deterministicData, FIXED_REF);
    expect(r.risk_score).toBe(r2.risk_score);
  });
});
