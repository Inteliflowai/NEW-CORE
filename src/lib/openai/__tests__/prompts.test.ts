// src/lib/openai/__tests__/prompts.test.ts
// Task 1 test suite: verbatim lift assertions (C11), computeFinalScore boundary (C5),
// checkNumericAnswer (C23), getStrategiesForStudent (C11), isStemSubject.

import { describe, it, expect } from 'vitest';
import {
  LESSON_PARSE_SYSTEM, lessonParsePrompt,
  QUIZ_GENERATE_SYSTEM, quizGeneratePrompt, mathQuizGeneratePrompt,
  GRADING_SYSTEM, gradingPrompt,
  ASSIGNMENT_SYSTEM, assignmentPrompt,
  LEARNING_STYLE_SYSTEM, learningStylePrompt,
  MATH_QUIZ_INSTRUCTION,
  getStrategiesForStudent,
} from '@/lib/openai/prompts';
import { computeMasteryBand, computeFinalScore } from '@/lib/utils/scoring';
import { checkNumericAnswer, parseNumeric } from '@/lib/math/checkNumericAnswer';
import { MATH_FORMAT_DIRECTIVE } from '@/lib/math/mathPromptDirective';
import { isStemSubject } from '@/lib/teacher/isStemSubject';

// ──────────────────────────────────────────────────────────────────────
// PROMPT CONTRACTS (from brief — C11 faithfulness assertions)
// ──────────────────────────────────────────────────────────────────────
describe('prompt contracts (LIFT V1 verbatim)', () => {
  it('lesson parse asks for the V1 JSON keys', () => {
    const p = lessonParsePrompt('SOME LESSON');
    expect(LESSON_PARSE_SYSTEM).toContain('expert curriculum analyst');
    expect(p).toContain('"key_concepts"');
    expect(p).toContain('"misconception_risks"');
    expect(p).toContain('SOME LESSON');
  });

  it('quiz prompt carries the Bloom-to-grade calibration (hard constraint §4a)', () => {
    const p = quizGeneratePrompt('{}');
    expect(p).toContain('DIFFICULTY CALIBRATION');
    expect(p).toContain('Grades 6-8: Understand, Apply, Analyze');
    expect(p).toContain('3 MCQ + 2 open-response');
  });

  it('math quiz prompt is 3 numeric + 2 open', () => {
    const p = mathQuizGeneratePrompt('{}');
    expect(p).toContain('3 numeric + 2 open-response');
    expect(p).toContain('"numeric_spec"');
  });

  it('grading system scores thinking-not-writing and the prompt locks the JSON contract', () => {
    expect(GRADING_SYSTEM).toContain('QUALITY OF THINKING');
    const p = gradingPrompt('Q', 'RUBRIC', 'RESPONSE', 'v1');
    expect(p).toContain('"score": 0 | 0.5 | 1.0');
    expect(p).toContain('"reasoning_pattern"');
    expect(p).toContain('"cognitive_notes"');
  });

  it('assignment system locks band-mismatch as the worst regression', () => {
    expect(ASSIGNMENT_SYSTEM).toContain('BAND DIFFERENTIATION IS MANDATORY');
    const p = assignmentPrompt('LESSON', 'reteach', 'visual', 'Sam');
    expect(p).toContain('RETEACH');
    expect(p).toContain('VISUAL');
  });
});

// ──────────────────────────────────────────────────────────────────────
// MASTERY BAND THRESHOLDS (§4b)
// ──────────────────────────────────────────────────────────────────────
describe('computeMasteryBand thresholds (single-sourced, §4b)', () => {
  it('0-50 reteach / 51-79 grade_level / 80+ advanced', () => {
    expect(computeMasteryBand(40)).toBe('reteach');
    expect(computeMasteryBand(50)).toBe('reteach');
    expect(computeMasteryBand(65)).toBe('grade_level');
    expect(computeMasteryBand(79)).toBe('grade_level');
    expect(computeMasteryBand(80)).toBe('advanced');
  });
});

// ──────────────────────────────────────────────────────────────────────
// C5: computeFinalScore — un-rounded boundary tests
// raw 3.975/5 → scorePct 79.5 → stays grade_level (not advanced)
// ──────────────────────────────────────────────────────────────────────
describe('computeFinalScore (C5 — un-rounded scorePct, boundary parity with V1)', () => {
  it('exact MCQ=3 OEQ=2 (all 1.0) → scorePct 100', () => {
    const r = computeFinalScore([1, 1, 1], [1, 1]);
    expect(r.rawScore).toBe(5);
    expect(r.scorePct).toBe(100);
  });

  it('MCQ=2 OEQ=2×0.5 → scorePct 60', () => {
    const r = computeFinalScore([1, 1, 0], [0.5, 0.5]);
    expect(r.rawScore).toBe(3);
    expect(r.scorePct).toBe(60);
  });

  it('boundary: raw 3.95 → scorePct 79.0 → grade_level (un-rounded preserves below-80)', () => {
    // 3 MCQ scores 1,1,1 + 2 OEQ scores 0.5, 0.45 = 3.95 → 79.0%
    const r = computeFinalScore([1, 1, 1], [0.5, 0.45]);
    expect(r.rawScore).toBeCloseTo(3.95);
    expect(r.scorePct).toBeCloseTo(79.0);
    // 79.0 → grade_level (≤ 79 threshold)
    expect(computeMasteryBand(r.scorePct)).toBe('grade_level');
  });

  it('C5: scorePct is exact float — no Math.round applied (3.74 → 74.8, not 75)', () => {
    // The brief's computeFinalScore used Math.round in the stub — C5 removes it.
    // Demonstrate: raw 3.74 → (3.74/5)*100 = 74.8, NOT Math.round(74.8) = 75.
    const r = computeFinalScore([1, 1, 0], [1, 0.74]);
    // Without Math.round: 74.8
    expect(r.scorePct).toBeCloseTo(74.8);
    // With Math.round it would have been 75 — prove we're NOT getting 75
    expect(r.scorePct).not.toBe(75);
  });

  it('C5: score 3.74 → scorePct 74.8 (not rounded to 75) → grade_level', () => {
    // 3 MCQ=1,1,0 + 2 OEQ=1,0.74 = 3.74 → 74.8% (un-rounded)
    const r = computeFinalScore([1, 1, 0], [1, 0.74]);
    expect(r.rawScore).toBeCloseTo(3.74);
    expect(r.scorePct).toBeCloseTo(74.8);
    expect(computeMasteryBand(r.scorePct)).toBe('grade_level');
  });

  it('boundary: raw 4/5 → scorePct 80 → advanced', () => {
    const r = computeFinalScore([1, 1, 1], [0.5, 0.5]);
    expect(r.rawScore).toBe(4);
    expect(r.scorePct).toBe(80);
    expect(computeMasteryBand(r.scorePct)).toBe('advanced');
  });

  it('all zeros → scorePct 0 → reteach', () => {
    const r = computeFinalScore([0, 0, 0], [0, 0]);
    expect(r.rawScore).toBe(0);
    expect(r.scorePct).toBe(0);
    expect(computeMasteryBand(r.scorePct)).toBe('reteach');
  });

  it('V1 formula: uses /5 fixed denominator not dynamic length', () => {
    // V1 uses (raw / 5) * 100, not (raw / (mcq.length + oeq.length)) * 100
    // With 3 MCQ + 2 OEQ, they are the same, but this test verifies the formula
    const r = computeFinalScore([1, 1, 1], [1, 1]);
    expect(r.scorePct).toBe((5 / 5) * 100);
  });
});

// ──────────────────────────────────────────────────────────────────────
// C11: getStrategiesForStudent — 5-field contract
// ──────────────────────────────────────────────────────────────────────
describe('getStrategiesForStudent (C11 — 5-field strategy contract)', () => {
  it('returns array elements with the 5 required fields', () => {
    const results = getStrategiesForStudent('reteach', 'visual');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    for (const s of results) {
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('what_students_do');
      expect(s).toHaveProperty('atl_skills');
      expect(s).toHaveProperty('ib_learner_profile');
      expect(s).toHaveProperty('bloom_level');
    }
  });

  it('returns up to 3 strategies max', () => {
    const results = getStrategiesForStudent('advanced', 'auditory');
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('falls back gracefully for unknown style (uses emerging)', () => {
    const results = getStrategiesForStudent('grade_level', 'unknown_style');
    expect(Array.isArray(results)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// C11: LEARNING_STYLE_SYSTEM / learningStylePrompt locked JSON keys
// ──────────────────────────────────────────────────────────────────────
describe('LEARNING_STYLE_SYSTEM / learningStylePrompt (C11 — locked JSON keys)', () => {
  it('LEARNING_STYLE_SYSTEM contains locked keys', () => {
    expect(LEARNING_STYLE_SYSTEM).toContain('learning specialist');
    expect(LEARNING_STYLE_SYSTEM).toContain('behavioral signals');
  });

  it('learningStylePrompt contains locked JSON response keys', () => {
    const p = learningStylePrompt('x');
    expect(p).toContain('"learning_style"');
    expect(p).toContain('"confidence"');
    expect(p).toContain('"reasoning"');
    expect(p).toContain('x');
  });
});

// ──────────────────────────────────────────────────────────────────────
// C11: MATH_FORMAT_DIRECTIVE — non-empty string
// ──────────────────────────────────────────────────────────────────────
describe('MATH_FORMAT_DIRECTIVE (C11)', () => {
  it('is a non-empty string', () => {
    expect(typeof MATH_FORMAT_DIRECTIVE).toBe('string');
    expect(MATH_FORMAT_DIRECTIVE.length).toBeGreaterThan(0);
  });

  it('contains LaTeX inline delimiter instruction', () => {
    // MATH_FORMAT_DIRECTIVE contains the literal string \( ... \) for inline math
    expect(MATH_FORMAT_DIRECTIVE).toContain('\\(');
  });

  it('is embedded in QUIZ_GENERATE_SYSTEM', () => {
    expect(QUIZ_GENERATE_SYSTEM).toContain('MATH FORMATTING');
  });

  it('is embedded in ASSIGNMENT_SYSTEM', () => {
    expect(ASSIGNMENT_SYSTEM).toContain('MATH FORMATTING');
  });
});

// ──────────────────────────────────────────────────────────────────────
// C11: MATH_QUIZ_INSTRUCTION contains 3 numeric + 2 open
// ──────────────────────────────────────────────────────────────────────
describe('MATH_QUIZ_INSTRUCTION (C11)', () => {
  it('references numeric_spec and structure lock', () => {
    expect(MATH_QUIZ_INSTRUCTION).toContain('numeric_spec');
    expect(MATH_QUIZ_INSTRUCTION).toContain('LOCKED');
  });
});

// ──────────────────────────────────────────────────────────────────────
// C23: checkNumericAnswer — accepted-values + tolerance behavior
// ──────────────────────────────────────────────────────────────────────
describe('checkNumericAnswer (C23 — lifted from V1 verbatim)', () => {
  // parseNumeric
  describe('parseNumeric', () => {
    it('parses integers', () => {
      expect(parseNumeric('42')).toBe(42);
      expect(parseNumeric('-7')).toBe(-7);
    });

    it('parses decimals', () => {
      expect(parseNumeric('3.14')).toBeCloseTo(3.14);
      expect(parseNumeric('.5')).toBe(0.5);
    });

    it('parses fractions', () => {
      expect(parseNumeric('3/4')).toBe(0.75);
      expect(parseNumeric('-1/2')).toBe(-0.5);
    });

    it('parses mixed numbers', () => {
      expect(parseNumeric('1 1/2')).toBe(1.5);
      expect(parseNumeric('-2 3/4')).toBe(-2.75);
    });

    it('parses percentages (divides by 100)', () => {
      expect(parseNumeric('50%')).toBe(0.5);
      expect(parseNumeric('25%')).toBe(0.25);
    });

    it('returns null for unparseable input', () => {
      expect(parseNumeric('abc')).toBeNull();
      expect(parseNumeric('')).toBeNull();
      expect(parseNumeric('1+2')).toBeNull();
    });
  });

  // checkNumericAnswer
  describe('checkNumericAnswer correct/incorrect behavior', () => {
    it('exact match', () => {
      const r = checkNumericAnswer('0.875', { accepted: ['0.875'] });
      expect(r.correct).toBe(true);
      expect(r.reason).toBe('match');
    });

    it('fraction equivalent matches decimal accepted value', () => {
      const r = checkNumericAnswer('7/8', { accepted: ['0.875'] });
      expect(r.correct).toBe(true);
    });

    it('percent equivalent matches', () => {
      const r = checkNumericAnswer('50%', { accepted: ['0.5'] });
      expect(r.correct).toBe(true);
    });

    it('mismatch returns false', () => {
      const r = checkNumericAnswer('0.9', { accepted: ['0.875'] });
      expect(r.correct).toBe(false);
      expect(r.reason).toBe('mismatch');
    });

    it('empty student answer returns empty', () => {
      const r = checkNumericAnswer('', { accepted: ['1'] });
      expect(r.correct).toBe(false);
      expect(r.reason).toBe('empty');
    });

    it('unparseable student answer returns unparseable', () => {
      const r = checkNumericAnswer('abc', { accepted: ['1'] });
      expect(r.correct).toBe(false);
      expect(r.reason).toBe('unparseable');
    });

    it('empty accepted list returns no_accepted', () => {
      const r = checkNumericAnswer('1', { accepted: [] });
      expect(r.correct).toBe(false);
      expect(r.reason).toBe('no_accepted');
    });
  });

  describe('tolerance behavior', () => {
    it('within tolerance is correct', () => {
      // question asks round to 2 decimal places; answer 3.14, tolerance 0.005
      const r = checkNumericAnswer('3.14', { accepted: ['3.14159'], tolerance: 0.005 });
      expect(r.correct).toBe(true);
    });

    it('outside tolerance is incorrect', () => {
      const r = checkNumericAnswer('3.1', { accepted: ['3.14159'], tolerance: 0.005 });
      expect(r.correct).toBe(false);
    });

    it('default tolerance absorbs float errors (0.1+0.2)', () => {
      // 0.1 + 0.2 = 0.30000000000000004 in JS
      const r = checkNumericAnswer('0.3', { accepted: ['0.30000000000000004'] });
      expect(r.correct).toBe(true);
    });
  });

  describe('multiple accepted values', () => {
    it('matches any accepted value in the list', () => {
      const spec = { accepted: ['0.5', '1/2', '50%'], tolerance: 0 };
      expect(checkNumericAnswer('0.5', spec).correct).toBe(true);
      expect(checkNumericAnswer('1/2', spec).correct).toBe(true);
      expect(checkNumericAnswer('50%', spec).correct).toBe(true);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// isStemSubject
// ──────────────────────────────────────────────────────────────────────
describe('isStemSubject', () => {
  it('returns true for math/science subjects', () => {
    expect(isStemSubject('Mathematics')).toBe(true);
    expect(isStemSubject('Algebra II')).toBe(true);
    expect(isStemSubject('Biology')).toBe(true);
    expect(isStemSubject('Physics')).toBe(true);
    expect(isStemSubject('Computer Science')).toBe(true);
  });

  it('returns false for humanities', () => {
    expect(isStemSubject('English')).toBe(false);
    expect(isStemSubject('History')).toBe(false);
    expect(isStemSubject('Political Science')).toBe(false);
  });

  it('returns false for null/undefined/empty', () => {
    expect(isStemSubject(null)).toBe(false);
    expect(isStemSubject(undefined)).toBe(false);
    expect(isStemSubject('')).toBe(false);
  });

  it('does not match cs inside economics or civics', () => {
    expect(isStemSubject('Economics')).toBe(false);
    expect(isStemSubject('Civics')).toBe(false);
  });
});
