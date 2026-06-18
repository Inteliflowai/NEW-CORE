// src/lib/engine/__tests__/errorEnvelope.test.ts
// TDD RED: written before implementation files exist.
import { describe, it, expect } from 'vitest';
import { errorEnvelope, respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { LlmExhaustedError } from '@/lib/ai/errors';
import { GradingResultSchema, LearningStyleSchema, GeneratedQuizSchema } from '@/lib/engine/types';

// ── §3.5 error envelope ───────────────────────────────────────────────────────

describe('error envelope (§3.5)', () => {
  it('produces the standard shape', () => {
    const e = errorEnvelope('llm_exhausted', 'all providers failed', true, 'Try again shortly.');
    expect(e).toEqual({
      error: { code: 'llm_exhausted', message: 'all providers failed', retryable: true, userMessage: 'Try again shortly.' },
    });
  });

  it('maps LlmExhaustedError to 503 retryable', async () => {
    const res = respondEngineError(new LlmExhaustedError('claude', new Error('429')));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.retryable).toBe(true);
  });

  it('maps unknown errors to 500 non-retryable', async () => {
    const res = respondEngineError(new Error('unexpected'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.retryable).toBe(false);
    expect(body.error.code).toBe('engine_error');
  });
});

// ── GradingResultSchema ───────────────────────────────────────────────────────

describe('GradingResultSchema (locks the V1 grading JSON contract)', () => {
  it('accepts a valid 0.5 grade with cognitive signals', () => {
    const ok = GradingResultSchema.safeParse({
      score: 0.5, explanation: 'partial', confidence: 0.8, grader_source: 'ai',
      error_type: 'incomplete', reasoning_pattern: 'partial_reasoning',
      misinterpretation_detected: false, vocabulary_difficulty: 'low',
      cognitive_notes: 'Identifies the theme but does not explain its connection.',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a score outside {0, 0.5, 1.0}', () => {
    const bad = GradingResultSchema.safeParse({
      score: 0.7, explanation: '', confidence: 0.5, grader_source: 'ai',
      error_type: 'none', reasoning_pattern: 'full_reasoning',
      misinterpretation_detected: false, vocabulary_difficulty: 'none', cognitive_notes: 'x',
    });
    expect(bad.success).toBe(false);
  });

  it('accepts score=0 (blank answer)', () => {
    const ok = GradingResultSchema.safeParse({
      score: 0, explanation: 'blank', confidence: 1.0, grader_source: 'ai',
      error_type: 'blank', reasoning_pattern: 'blank_or_off_topic',
      misinterpretation_detected: false, vocabulary_difficulty: 'none', cognitive_notes: 'no answer',
    });
    expect(ok.success).toBe(true);
  });

  it('accepts score=1.0 (full credit)', () => {
    const ok = GradingResultSchema.safeParse({
      score: 1.0, explanation: 'correct', confidence: 0.95, grader_source: 'ai',
      error_type: 'none', reasoning_pattern: 'full_reasoning',
      misinterpretation_detected: false, vocabulary_difficulty: 'none', cognitive_notes: 'perfect',
    });
    expect(ok.success).toBe(true);
  });
});

// ── LearningStyleSchema (C6: 6 correct values, no 'social') ──────────────────

describe('LearningStyleSchema (C6: exactly 6 enum values)', () => {
  const validStyles = ['visual', 'auditory', 'read_write', 'kinesthetic', 'tactile', 'emerging'] as const;

  for (const style of validStyles) {
    it(`accepts learning_style='${style}'`, () => {
      const ok = LearningStyleSchema.safeParse({ learning_style: style, confidence: 0.8 });
      expect(ok.success).toBe(true);
    });
  }

  it("rejects learning_style='social' (not in V1 prompt enum)", () => {
    const bad = LearningStyleSchema.safeParse({ learning_style: 'social', confidence: 0.8 });
    expect(bad.success).toBe(false);
  });

  it("rejects learning_style='multimodal' (unknown value)", () => {
    const bad = LearningStyleSchema.safeParse({ learning_style: 'multimodal', confidence: 0.5 });
    expect(bad.success).toBe(false);
  });
});

// ── GeneratedQuizSchema (C24: enforce 3+2 structural shape) ─────────────────

describe('GeneratedQuizSchema (C24: 3+2 structure refinement)', () => {
  const makeQuestion = (position: number, type: 'mcq' | 'open' | 'numeric', extras: object = {}) => ({
    position,
    question_type: type,
    question_text: `Q${position}?`,
    ...extras,
  });

  const validMcqExtras = { choices: [{ label: 'A', text: 'Choice A' }, { label: 'B', text: 'Choice B' }], correct_answer: 'A' };
  const validOpenExtras = { rubric: 'Explain in detail.' };
  const validNumericExtras = { numeric_spec: { accepted: ['42'], tolerance: 0.1 } };

  it('accepts a valid 3-mcq + 2-open quiz', () => {
    const ok = GeneratedQuizSchema.safeParse({
      title: 'History Quiz',
      questions: [
        makeQuestion(1, 'mcq', validMcqExtras),
        makeQuestion(2, 'mcq', validMcqExtras),
        makeQuestion(3, 'mcq', validMcqExtras),
        makeQuestion(4, 'open', validOpenExtras),
        makeQuestion(5, 'open', validOpenExtras),
      ],
    });
    expect(ok.success).toBe(true);
  });

  it('accepts a valid 2-mcq + 1-numeric + 2-open quiz (STEM path)', () => {
    const ok = GeneratedQuizSchema.safeParse({
      title: 'Math Quiz',
      questions: [
        makeQuestion(1, 'mcq', validMcqExtras),
        makeQuestion(2, 'mcq', validMcqExtras),
        makeQuestion(3, 'numeric', validNumericExtras),
        makeQuestion(4, 'open', validOpenExtras),
        makeQuestion(5, 'open', validOpenExtras),
      ],
    });
    expect(ok.success).toBe(true);
  });

  it('FAILS a 5-open-question quiz (violates 3+2 structure)', () => {
    const bad = GeneratedQuizSchema.safeParse({
      title: 'Bad Quiz',
      questions: [
        makeQuestion(1, 'open', validOpenExtras),
        makeQuestion(2, 'open', validOpenExtras),
        makeQuestion(3, 'open', validOpenExtras),
        makeQuestion(4, 'open', validOpenExtras),
        makeQuestion(5, 'open', validOpenExtras),
      ],
    });
    expect(bad.success).toBe(false);
  });

  it('FAILS when positions 4–5 are mcq instead of open', () => {
    const bad = GeneratedQuizSchema.safeParse({
      title: 'Bad Quiz',
      questions: [
        makeQuestion(1, 'mcq', validMcqExtras),
        makeQuestion(2, 'mcq', validMcqExtras),
        makeQuestion(3, 'mcq', validMcqExtras),
        makeQuestion(4, 'mcq', validMcqExtras),
        makeQuestion(5, 'mcq', validMcqExtras),
      ],
    });
    expect(bad.success).toBe(false);
  });

  it('FAILS when mcq question is missing choices', () => {
    const bad = GeneratedQuizSchema.safeParse({
      title: 'Bad Quiz',
      questions: [
        makeQuestion(1, 'mcq'), // no choices
        makeQuestion(2, 'mcq', validMcqExtras),
        makeQuestion(3, 'mcq', validMcqExtras),
        makeQuestion(4, 'open', validOpenExtras),
        makeQuestion(5, 'open', validOpenExtras),
      ],
    });
    expect(bad.success).toBe(false);
  });

  it('FAILS when open question is missing rubric', () => {
    const bad = GeneratedQuizSchema.safeParse({
      title: 'Bad Quiz',
      questions: [
        makeQuestion(1, 'mcq', validMcqExtras),
        makeQuestion(2, 'mcq', validMcqExtras),
        makeQuestion(3, 'mcq', validMcqExtras),
        makeQuestion(4, 'open'), // no rubric
        makeQuestion(5, 'open', validOpenExtras),
      ],
    });
    expect(bad.success).toBe(false);
  });

  it('FAILS when numeric question is missing numeric_spec', () => {
    const bad = GeneratedQuizSchema.safeParse({
      title: 'Bad Quiz',
      questions: [
        makeQuestion(1, 'mcq', validMcqExtras),
        makeQuestion(2, 'mcq', validMcqExtras),
        makeQuestion(3, 'numeric'), // no numeric_spec
        makeQuestion(4, 'open', validOpenExtras),
        makeQuestion(5, 'open', validOpenExtras),
      ],
    });
    expect(bad.success).toBe(false);
  });

  it('requires exactly 5 questions', () => {
    const bad = GeneratedQuizSchema.safeParse({
      title: 'Short Quiz',
      questions: [
        makeQuestion(1, 'mcq', validMcqExtras),
        makeQuestion(2, 'open', validOpenExtras),
      ],
    });
    expect(bad.success).toBe(false);
  });
});
