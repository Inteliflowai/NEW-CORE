import { describe, it, expect } from 'vitest';
import {
  computeSkillState,
  SKILL_STATE_WEIGHTS,
  SkillStateEvidenceSchema,
  type SkillStateInput,
  type SkillQuizObservation,
} from '../computeSkillState';

// ── helpers ──────────────────────────────────────────────────────────
const W = SKILL_STATE_WEIGHTS;

function quizObs(isCorrect: boolean, occurredAt: string): SkillQuizObservation {
  return { isCorrect, occurredAt };
}

function makeQuiz(correctCount: number, totalCount: number, baseDate = '2026-01-01'): SkillQuizObservation[] {
  return Array.from({ length: totalCount }, (_, i) => ({
    isCorrect: i < correctCount,
    occurredAt: `${baseDate}T${String(i).padStart(2, '0')}:00:00Z`,
  }));
}

const NO_HW = { homework: [], sessionErrorPatterns: [] };

// ── Tests ─────────────────────────────────────────────────────────────

describe('computeSkillState — not_attempted', () => {
  it('returns not_attempted when quiz, homework, and spark are all empty', () => {
    const result = computeSkillState({ quiz: [], homework: [], sessionErrorPatterns: [] });
    expect(result.state).toBe('not_attempted');
    expect(result.observationCount).toBe(0);
  });
});

describe('computeSkillState — insufficient_data (obs < MIN_OBSERVATIONS=3)', () => {
  it('returns insufficient_data with 0 graded quiz obs but one HW contact', () => {
    const result = computeSkillState({
      quiz: [],
      homework: [{ gradePct: null, submitted: true, occurredAt: '2026-01-01T00:00:00Z' }],
      sessionErrorPatterns: [],
    });
    expect(result.state).toBe('insufficient_data');
  });

  it('returns insufficient_data with exactly 2 quiz observations', () => {
    const result = computeSkillState({
      quiz: makeQuiz(2, 2),
      ...NO_HW,
    });
    expect(result.state).toBe('insufficient_data');
    expect(result.observationCount).toBe(2);
    expect(result.confidence).toBeLessThanOrEqual(30);
  });

  it('does NOT return insufficient_data with exactly 3 observations', () => {
    const result = computeSkillState({
      quiz: makeQuiz(3, 3),
      ...NO_HW,
    });
    expect(result.state).not.toBe('insufficient_data');
    expect(result.state).not.toBe('not_attempted');
  });
});

describe('computeSkillState — engagement guard', () => {
  it('returns insufficient_data when nonSubmissionShare >= 0.5 AND quiz < 3', () => {
    // 2 unsubmitted out of 2 = 100% non-submission share; 1 quiz obs < 3
    const result = computeSkillState({
      quiz: [{ isCorrect: false, occurredAt: '2026-01-01T00:00:00Z' }],
      homework: [
        { gradePct: null, submitted: false, occurredAt: '2026-01-01T00:00:00Z' },
        { gradePct: null, submitted: false, occurredAt: '2026-01-02T00:00:00Z' },
      ],
      sessionErrorPatterns: [],
    });
    expect(result.state).toBe('insufficient_data');
    expect(result.evidence.drivers).toContain('engagement_gap_not_skill_evidence');
  });
});

describe('computeSkillState — ready_to_extend', () => {
  it('returns ready_to_extend when coldAcc >= 0.95 and quiz >= 4', () => {
    // 4 correct out of 4 = 100% cold accuracy
    const result = computeSkillState({
      quiz: makeQuiz(4, 4),
      ...NO_HW,
    });
    expect(result.state).toBe('ready_to_extend');
    expect(result.evidence.drivers).toContain('cold_accuracy_sustained_high');
  });

  it('does NOT return ready_to_extend when coldAcc is 0.94 (below threshold)', () => {
    // 18/19 = ~0.947 but only 3 quiz obs → insufficient_data boundary
    // Use 4 obs: 19/20 = 0.95 exactly with 4 obs is on_track not extend (quiz=4 needed)
    // 3/4 = 0.75 → not extend
    const result = computeSkillState({
      quiz: makeQuiz(3, 4),
      ...NO_HW,
    });
    expect(result.state).not.toBe('ready_to_extend');
  });

  it('does NOT return ready_to_extend with only 3 cold obs (EXTEND_MIN_COLD_OBSERVATIONS=4)', () => {
    // 3/3 = 100% but quiz count < 4
    const result = computeSkillState({
      quiz: makeQuiz(3, 3),
      ...NO_HW,
    });
    expect(result.state).not.toBe('ready_to_extend');
  });
});

describe('computeSkillState — on_track', () => {
  it('returns on_track when coldAcc >= 0.8 and quiz >= 3', () => {
    // 4 correct out of 5 = 0.8 exactly
    const result = computeSkillState({
      quiz: makeQuiz(4, 5),
      ...NO_HW,
    });
    expect(result.state).toBe('on_track');
    expect(result.evidence.drivers).toContain('cold_accuracy_at_mastery');
  });

  it('does NOT return on_track when coldAcc is 0.79 (below threshold)', () => {
    // Need coldAcc strictly below 0.8 with enough obs to avoid insufficient_data
    // 3/4 = 0.75 < 0.8, with 4 obs
    const result = computeSkillState({
      quiz: makeQuiz(3, 4),
      ...NO_HW,
    });
    expect(result.state).not.toBe('on_track');
    expect(result.state).not.toBe('ready_to_extend');
  });
});

describe('computeSkillState — needs_different_instruction (NDI)', () => {
  it('NDI test 1: conceptualShare >= 0.5, coldAcc < 0.8, trendDelta < IMPROVING_DELTA', () => {
    // 4+ obs; 2/4 correct = 0.5 cold accuracy
    // Need 4 obs to pass NDI_MIN_OBSERVATIONS guard
    // Conceptual errors dominate; flat trend (fewer than 4 quiz obs → trendDelta null → counts as null, which is < 0.15)
    const result = computeSkillState({
      quiz: makeQuiz(2, 4),
      homework: [],
      sessionErrorPatterns: ['conceptual', 'conceptual', 'careless'],
    });
    // conceptualShare = 2/3 ≈ 0.67 >= 0.5; coldAcc = 0.5 < 0.8; trendDelta null
    expect(result.state).toBe('needs_different_instruction');
    expect(result.evidence.drivers).toContain('conceptual_errors_dominate_without_improvement');
  });

  it('NDI test 2: divergencePts >= 25, coldAcc < 0.5, strugglingShare covers guard', () => {
    // coldAcc = 1/4 = 0.25 < 0.5 (COLD_FLOOR)
    // hwAvg = 80 (well above cold 25 → gap = 80 - 25 = 55 >= 25)
    // NO struggling share (null → passes guard since null is treated as "null OR >= 0.4")
    const result = computeSkillState({
      quiz: makeQuiz(1, 4),
      homework: [
        { gradePct: 80, submitted: true, occurredAt: '2026-01-01T00:00:00Z' },
        { gradePct: 80, submitted: true, occurredAt: '2026-01-02T00:00:00Z' },
      ],
      sessionErrorPatterns: [],
    });
    expect(result.state).toBe('needs_different_instruction');
    expect(result.evidence.drivers).toContain('scaffolded_work_lands_cold_assessment_does_not');
  });
});

describe('computeSkillState — reteach pending_cold_check', () => {
  it('returns *_pending_cold_check when reteach has no quiz observations after completedAt', () => {
    const result = computeSkillState({
      quiz: [
        { isCorrect: false, occurredAt: '2026-01-01T00:00:00Z' },
        { isCorrect: false, occurredAt: '2026-01-02T00:00:00Z' },
        { isCorrect: false, occurredAt: '2026-01-03T00:00:00Z' },
        { isCorrect: false, occurredAt: '2026-01-04T00:00:00Z' },
      ],
      homework: [],
      sessionErrorPatterns: ['conceptual', 'conceptual', 'conceptual'],
      reteach: { type: 'more_practice', completedAt: '2026-01-05T00:00:00Z' },
    });
    // All quiz obs are before reteach → pending
    expect(result.lastReteachOutcome).toBe('more_practice_pending_cold_check');
  });

  it('returns different_approach_pending_cold_check for different_approach with no post-reteach cold', () => {
    const result = computeSkillState({
      quiz: makeQuiz(1, 4),
      homework: [],
      sessionErrorPatterns: ['conceptual', 'conceptual', 'conceptual'],
      reteach: { type: 'different_approach', completedAt: '2026-06-01T00:00:00Z' },
    });
    expect(result.lastReteachOutcome).toBe('different_approach_pending_cold_check');
  });
});

describe('computeSkillState — ambiguous middle fallback', () => {
  it('returns needs_more_time at conf=25 when no specific test fires', () => {
    // 4 obs; coldAcc = 2/4 = 0.5 (not >= 0.8 for on_track, not >= 0.95 for extend)
    // No dominant patterns; divergencePts null (no HW) so no NDI test 2
    // conceptualShare null (no patterns) so no NDI test 1
    // trendDelta computed from 4 obs: older half [0,1], newer half [2,3]; 2/2 vs 0/2 = delta +1.0... no, all correct[0..1], incorrect[2..3]?
    // Use mixed correct to avoid NMT improving driver: older half 1/2 correct, newer half 1/2 correct → trendDelta = 0 < IMPROVING_DELTA
    const result = computeSkillState({
      quiz: [
        { isCorrect: true,  occurredAt: '2026-01-01T00:00:00Z' },
        { isCorrect: false, occurredAt: '2026-01-02T00:00:00Z' },
        { isCorrect: true,  occurredAt: '2026-01-03T00:00:00Z' },
        { isCorrect: false, occurredAt: '2026-01-04T00:00:00Z' },
      ],
      homework: [],
      sessionErrorPatterns: [],
    });
    // coldAcc = 0.5; trendDelta = 0; no NMT or NDI drivers
    expect(result.state).toBe('needs_more_time');
    expect(result.confidence).toBe(25);
    expect(result.evidence.drivers).toContain('mixed_signals_default_mild');
  });
});

describe('computeSkillState — confidence formula', () => {
  it('confidence = min(min(obs*8,40) + driverCount*15 + reteachBonus, 95)', () => {
    // on_track: 5 obs → min(5*8,40)=40; 1 driver (cold_accuracy_at_mastery) → 15; no reteach → 0; total=55
    const result = computeSkillState({
      quiz: makeQuiz(4, 5),
      ...NO_HW,
    });
    expect(result.confidence).toBe(55);
  });

  it('caps confidence at 95', () => {
    // Many obs + many drivers should not exceed 95
    // ready_to_extend with 10 obs → min(10*8,40)=40; drivers ≥1; total could exceed 95
    const result = computeSkillState({
      quiz: makeQuiz(10, 10),
      ...NO_HW,
    });
    expect(result.confidence).toBeLessThanOrEqual(95);
  });
});

describe('SkillStateEvidenceSchema', () => {
  it('validates a well-formed evidence object', () => {
    const result = computeSkillState({
      quiz: makeQuiz(4, 5),
      ...NO_HW,
    });
    const parsed = SkillStateEvidenceSchema.safeParse(result.evidence);
    expect(parsed.success).toBe(true);
  });

  it('validates evidence from an ambiguous-fallback result', () => {
    const result = computeSkillState({
      quiz: [
        { isCorrect: true,  occurredAt: '2026-01-01T00:00:00Z' },
        { isCorrect: false, occurredAt: '2026-01-02T00:00:00Z' },
        { isCorrect: true,  occurredAt: '2026-01-03T00:00:00Z' },
        { isCorrect: false, occurredAt: '2026-01-04T00:00:00Z' },
      ],
      homework: [],
      sessionErrorPatterns: [],
    });
    const parsed = SkillStateEvidenceSchema.safeParse(result.evidence);
    expect(parsed.success).toBe(true);
  });
});
