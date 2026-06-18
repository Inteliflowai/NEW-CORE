// scripts/eval/__tests__/invokeCandidate.test.ts
// Tests for Stage B invokeCandidate wiring + interim golden fixture corpus validation.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGrade = vi.fn();
vi.mock('@/lib/engine/grading', () => ({ gradeOpenResponse: (...a: unknown[]) => mockGrade(...a) }));

describe('invokeCandidate (Stage B wiring)', () => {
  beforeEach(() => mockGrade.mockReset());

  it('routes a grading tuple into the real engine fn', async () => {
    mockGrade.mockResolvedValue({ score: 1.0, cognitive_notes: 'full reasoning', reasoning_pattern: 'full_reasoning' });
    const { invokeCandidate } = await import('../runner');
    const tuple = {
      id: 't1', scope: 'grading',
      input: { question: 'Q', rubric: 'R', student_response: 'ans', grade_band: '7', student_profile_summary: '' },
      expected_output: { score: 1.0, cognitive_notes: 'x', reasoning_pattern: 'full_reasoning' },
      metadata: { sampled_from_attempt_id: null, sampled_at: '', barb_reviewed: true, notes: '' },
    };
    const out = await invokeCandidate('grading', tuple as never);
    expect(mockGrade).toHaveBeenCalledOnce();
    expect((out as { score: number }).score).toBe(1.0);
  });

  it('throws for scopes not yet wired', async () => {
    const { invokeCandidate } = await import('../runner');
    const tuple = {
      id: 't2', scope: 'spark-generation',
      input: { lesson_plan_summary: '', student_profile_summary: '', comprehension_band: 'grade_level', learning_style: 'visual', grade_band: '7' },
      expected_output: { sections_present: { scenario: true, problem: true, action: true, reflection: true, knowledge_transfer: true, tiered_inputs: true, strategy_layer: true, outputs: true, teli_block: true }, concept_anchors: [] },
      metadata: { sampled_from_attempt_id: null, sampled_at: '', barb_reviewed: false, notes: '' },
    };
    await expect(invokeCandidate('spark-generation', tuple as never)).rejects.toThrow('not yet wired');
  });
});

describe('interim golden fixtures', () => {
  it('every scope corpus has at least one tuple (no AI path merges ungated)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { ALL_SCOPES } = await import('../types');
    for (const scope of ALL_SCOPES) {
      const arr = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/eval/corpus', `${scope}.json`), 'utf8'));
      expect(Array.isArray(arr), scope).toBe(true);
      expect(arr.length, `${scope} must have an interim golden fixture`).toBeGreaterThan(0);
    }
  });

  it('every tuple has required base keys (id, scope, input, expected_output, metadata)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { ALL_SCOPES } = await import('../types');
    for (const scope of ALL_SCOPES) {
      const arr = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/eval/corpus', `${scope}.json`), 'utf8'));
      for (const tuple of arr) {
        expect(tuple, `${scope}: missing id`).toHaveProperty('id');
        expect(tuple, `${scope}: missing scope`).toHaveProperty('scope');
        expect(tuple, `${scope}: missing input`).toHaveProperty('input');
        expect(tuple, `${scope}: missing expected_output`).toHaveProperty('expected_output');
        expect(tuple, `${scope}: missing metadata`).toHaveProperty('metadata');
      }
    }
  });

  it('grading: expected_output.score is a number', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const arr = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/eval/corpus/grading.json'), 'utf8'));
    for (const t of arr) {
      expect(typeof t.expected_output.score, 'grading score must be number').toBe('number');
    }
  });

  it('quiz-generation: expected_output.questions is non-empty array', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const arr = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/eval/corpus/quiz-generation.json'), 'utf8'));
    for (const t of arr) {
      expect(Array.isArray(t.expected_output.questions), 'quiz-generation questions must be array').toBe(true);
      expect(t.expected_output.questions.length, 'quiz-generation questions must be non-empty').toBeGreaterThan(0);
    }
  });

  it('spark-generation: sections_present has all 9 keys', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const arr = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/eval/corpus/spark-generation.json'), 'utf8'));
    const expected9 = ['scenario', 'problem', 'action', 'reflection', 'knowledge_transfer', 'tiered_inputs', 'strategy_layer', 'outputs', 'teli_block'];
    for (const t of arr) {
      for (const key of expected9) {
        expect(t.expected_output.sections_present, `spark-generation missing section: ${key}`).toHaveProperty(key);
      }
    }
  });

  it('spark-rubric: dimensions has canonical 7 keys + content_quality', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const arr = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/eval/corpus/spark-rubric.json'), 'utf8'));
    const canonical7 = ['reasoning_strategy', 'use_of_evidence', 'creativity_application', 'communication', 'collaboration', 'reflection_metacognition', 'problem_understanding'];
    for (const t of arr) {
      for (const key of canonical7) {
        expect(t.expected_output.dimensions, `spark-rubric missing dimension: ${key}`).toHaveProperty(key);
      }
      expect(t.expected_output, 'spark-rubric missing content_quality').toHaveProperty('content_quality');
    }
  });

  it('learner-profile: expected_output has 3 audience objects + teacher_prompt + teacher_takeaway (C19)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const arr = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/eval/corpus/learner-profile.json'), 'utf8'));
    for (const t of arr) {
      const eo = t.expected_output;
      // Three audience objects
      for (const field of ['short_narrative', 'strongest_signals', 'growth_areas']) {
        expect(eo, `learner-profile missing ${field}`).toHaveProperty(field);
        expect(eo[field], `learner-profile.${field} missing student`).toHaveProperty('student');
        expect(eo[field], `learner-profile.${field} missing parent`).toHaveProperty('parent');
        expect(eo[field], `learner-profile.${field} missing teacher`).toHaveProperty('teacher');
      }
      // Two teacher strings
      expect(eo, 'learner-profile missing teacher_prompt').toHaveProperty('teacher_prompt');
      expect(eo, 'learner-profile missing teacher_takeaway').toHaveProperty('teacher_takeaway');
      expect(typeof eo.teacher_prompt).toBe('string');
      expect(typeof eo.teacher_takeaway).toBe('string');
    }
  });
});
