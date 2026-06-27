// src/lib/chapters/__tests__/gradeChapterTest.test.ts
//
// TDD tests for gradeChapterTest — synchronous graders (T1), Claude grader (T2),
// and orchestrator (T3).
//
// Environment: node (default vitest env — pure lib, no jsdom needed).
//
// Mock strategy:
//   - resilientClaudeChat: vi.mock with wrapper fn (avoids vi.fn() hoisting bug)
//   - CLAUDE_CHAPTER_MODEL: vi.mock to avoid env-var dependency
//   - admin SupabaseClient: hand-rolled chainable stub (table-dispatching)

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Wrap in arrow fn to avoid ReferenceError from vi.fn() hoisting
const mockResilientClaudeChat = vi.fn();
vi.mock('@/lib/ai/claude', () => ({
  resilientClaudeChat: (...a: unknown[]) => mockResilientClaudeChat(...a),
}));
vi.mock('@/lib/ai/models', () => ({
  CLAUDE_CHAPTER_MODEL: 'claude-opus-4-8',
  CLAUDE_GRADING_MODEL: 'claude-sonnet-4-6',
}));

import { gradeMcq, gradeMatching, gradeOpenEnded } from '@/lib/chapters/gradeChapterTest';

// ── Shared fixture types ──────────────────────────────────────────────────────

interface QuestionRow {
  id: string;
  question_type: string;
  question_text: string;
  payload: Record<string, unknown>;
  points: number;
}

interface ResponseRow {
  response_text: string | null;
  response_payload: Record<string, unknown> | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// T1: gradeMcq
// ═══════════════════════════════════════════════════════════════════════════════

describe('gradeMcq', () => {
  const question: QuestionRow = {
    id: 'q-mcq-1',
    question_type: 'mcq',
    question_text: 'What is the capital of France?',
    payload: {
      choices: [
        { label: 'A', text: 'Berlin' },
        { label: 'B', text: 'Paris' },
        { label: 'C', text: 'Rome' },
      ],
      correct_answer: 'B',
    },
    points: 4,
  };

  it('returns full points and "Correct." when selected_label matches correct_answer', () => {
    const response: ResponseRow = {
      response_text: null,
      response_payload: { selected_label: 'B' },
    };
    const result = gradeMcq(question, response);
    expect(result.grade).toBe(4);
    expect(result.ai_feedback).toBe('Correct.');
  });

  it('returns 0 and reveals correct answer when selected_label is wrong', () => {
    const response: ResponseRow = {
      response_text: null,
      response_payload: { selected_label: 'A' },
    };
    const result = gradeMcq(question, response);
    expect(result.grade).toBe(0);
    expect(result.ai_feedback).toContain('B');
  });

  it('returns 0 when response is null', () => {
    const result = gradeMcq(question, null);
    expect(result.grade).toBe(0);
  });

  it('returns 0 when response_payload is null', () => {
    const response: ResponseRow = { response_text: null, response_payload: null };
    const result = gradeMcq(question, response);
    expect(result.grade).toBe(0);
  });

  it('returns 0 when selected_label is absent from response_payload', () => {
    const response: ResponseRow = {
      response_text: null,
      response_payload: { other_key: 'B' },
    };
    const result = gradeMcq(question, response);
    expect(result.grade).toBe(0);
  });

  it('grade never exceeds question.points', () => {
    const response: ResponseRow = {
      response_text: null,
      response_payload: { selected_label: 'B' },
    };
    const result = gradeMcq(question, response);
    expect(result.grade).toBeLessThanOrEqual(question.points);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T1: gradeMatching
// ═══════════════════════════════════════════════════════════════════════════════

describe('gradeMatching', () => {
  // 9 pts / 3 pairs → [3, 3, 3] (clean division, predictable per-pair values)
  const question: QuestionRow = {
    id: 'q-match-1',
    question_type: 'matching',
    question_text: 'Match each country to its capital.',
    payload: {
      left: ['France', 'Germany', 'Italy'],
      right: ['Paris', 'Berlin', 'Rome'],
      pairs: [
        { left_idx: 0, right_idx: 0 }, // France → Paris
        { left_idx: 1, right_idx: 1 }, // Germany → Berlin
        { left_idx: 2, right_idx: 2 }, // Italy → Rome
      ],
    },
    points: 9,
  };

  it('returns full points and "3 out of 3" when all pairs are correct', () => {
    const response: ResponseRow = {
      response_text: null,
      response_payload: {
        pairs: [
          { left_idx: 0, right_idx: 0 },
          { left_idx: 1, right_idx: 1 },
          { left_idx: 2, right_idx: 2 },
        ],
      },
    };
    const result = gradeMatching(question, response);
    expect(result.grade).toBe(9);
    expect(result.ai_feedback).toContain('3 out of 3');
  });

  it('returns proportional points for partial correct pairs', () => {
    // 2 of 3 pairs correct → 3+3 = 6 pts
    const response: ResponseRow = {
      response_text: null,
      response_payload: {
        pairs: [
          { left_idx: 0, right_idx: 0 }, // correct
          { left_idx: 1, right_idx: 1 }, // correct
          { left_idx: 2, right_idx: 0 }, // wrong
        ],
      },
    };
    const result = gradeMatching(question, response);
    expect(result.grade).toBe(6);
    expect(result.ai_feedback).toContain('2 out of 3');
  });

  it('returns 0 and "No response." when response is null', () => {
    const result = gradeMatching(question, null);
    expect(result.grade).toBe(0);
    expect(result.ai_feedback).toBe('No response.');
  });

  it('returns 0 when response_payload has no pairs key', () => {
    const response: ResponseRow = { response_text: null, response_payload: {} };
    const result = gradeMatching(question, response);
    expect(result.grade).toBe(0);
  });

  it('returns 0 when student pairs array is empty', () => {
    const response: ResponseRow = {
      response_text: null,
      response_payload: { pairs: [] },
    };
    const result = gradeMatching(question, response);
    expect(result.grade).toBe(0);
  });

  it('grade never exceeds question.points even when all pairs correct', () => {
    const response: ResponseRow = {
      response_text: null,
      response_payload: {
        pairs: [
          { left_idx: 0, right_idx: 0 },
          { left_idx: 1, right_idx: 1 },
          { left_idx: 2, right_idx: 2 },
        ],
      },
    };
    const result = gradeMatching(question, response);
    expect(result.grade).toBeLessThanOrEqual(question.points);
  });

  it('handles uneven distribution: last pair absorbs remainder → all correct = full points', () => {
    // 10 pts / 3 pairs → [3, 3, 4]; all correct → 10
    const unevenQ: QuestionRow = { ...question, id: 'q-uneven', points: 10 };
    const response: ResponseRow = {
      response_text: null,
      response_payload: {
        pairs: [
          { left_idx: 0, right_idx: 0 },
          { left_idx: 1, right_idx: 1 },
          { left_idx: 2, right_idx: 2 },
        ],
      },
    };
    const result = gradeMatching(unevenQ, response);
    expect(result.grade).toBe(10);
  });

  it('returns 3 for only 1 correct pair (first pair worth base pts)', () => {
    const response: ResponseRow = {
      response_text: null,
      response_payload: {
        pairs: [{ left_idx: 0, right_idx: 0 }],
      },
    };
    const result = gradeMatching(question, response);
    expect(result.grade).toBe(3);
    expect(result.ai_feedback).toContain('1 out of 3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// T2: gradeOpenEnded
// ═══════════════════════════════════════════════════════════════════════════════

describe('gradeOpenEnded', () => {
  const question: QuestionRow = {
    id: 'q-sa-1',
    question_type: 'short_answer',
    question_text: 'Explain the water cycle in your own words.',
    payload: {
      rubric: 'Award full credit for mentioning evaporation, condensation, and precipitation.',
    },
    points: 5,
  };

  beforeEach(() => {
    mockResilientClaudeChat.mockReset();
  });

  it('calls resilientClaudeChat and returns parsed grade + feedback for a valid response', async () => {
    mockResilientClaudeChat.mockResolvedValue({
      content: JSON.stringify({ grade: 4, feedback: 'Good explanation.' }),
    });

    const response: ResponseRow = {
      response_text: 'Water evaporates, forms clouds, then falls as rain.',
      response_payload: null,
    };
    const result = await gradeOpenEnded(question, response);

    expect(mockResilientClaudeChat).toHaveBeenCalledTimes(1);
    expect(result.grade).toBe(4);
    expect(result.ai_feedback).toBe('Good explanation.');
  });

  it('returns grade=0 and "No response." without calling Claude for null response', async () => {
    const result = await gradeOpenEnded(question, null);

    expect(mockResilientClaudeChat).not.toHaveBeenCalled();
    expect(result.grade).toBe(0);
    expect(result.ai_feedback).toBe('No response.');
  });

  it('returns grade=0 without calling Claude for empty string response_text', async () => {
    const response: ResponseRow = { response_text: '', response_payload: null };
    const result = await gradeOpenEnded(question, response);

    expect(mockResilientClaudeChat).not.toHaveBeenCalled();
    expect(result.grade).toBe(0);
  });

  it('returns grade=0 without calling Claude for whitespace-only response_text', async () => {
    const response: ResponseRow = { response_text: '   \n  ', response_payload: null };
    const result = await gradeOpenEnded(question, response);

    expect(mockResilientClaudeChat).not.toHaveBeenCalled();
    expect(result.grade).toBe(0);
  });

  it('passes CLAUDE_CHAPTER_MODEL, max_tokens:500, and NO temperature to resilientClaudeChat', async () => {
    mockResilientClaudeChat.mockResolvedValue({
      content: JSON.stringify({ grade: 3, feedback: 'Partial.' }),
    });

    const response: ResponseRow = {
      response_text: 'Water falls from clouds.',
      response_payload: null,
    };
    await gradeOpenEnded(question, response);

    const [callArgs] = mockResilientClaudeChat.mock.calls[0] as [Record<string, unknown>];
    expect(callArgs.model).toBe('claude-opus-4-8');
    expect(callArgs.max_tokens).toBe(500);
    expect('temperature' in callArgs).toBe(false);
  });

  it('returns grade=0 + ai_feedback="" + calls console.error when Claude returns invalid JSON', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockResilientClaudeChat.mockResolvedValue({ content: 'not valid json {{{{' });

    const response: ResponseRow = { response_text: 'Some answer.', response_payload: null };
    const result = await gradeOpenEnded(question, response);

    expect(result.grade).toBe(0);
    expect(result.ai_feedback).toBe('');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('returns grade=0 without throwing when Claude returns null', async () => {
    mockResilientClaudeChat.mockResolvedValue(null);

    const response: ResponseRow = { response_text: 'Some answer.', response_payload: null };
    await expect(gradeOpenEnded(question, response)).resolves.toMatchObject({
      grade: 0,
      ai_feedback: '',
    });
  });

  it('clamps grade to question.points when Claude returns a higher value', async () => {
    mockResilientClaudeChat.mockResolvedValue({
      content: JSON.stringify({ grade: 99, feedback: 'Excellent!' }),
    });

    const response: ResponseRow = { response_text: 'Perfect answer.', response_payload: null };
    const result = await gradeOpenEnded(question, response);

    expect(result.grade).toBe(question.points); // 5, not 99
  });

  it('clamps grade to 0 when Claude returns a negative value', async () => {
    mockResilientClaudeChat.mockResolvedValue({
      content: JSON.stringify({ grade: -3, feedback: 'Wrong.' }),
    });

    const response: ResponseRow = { response_text: 'Some answer.', response_payload: null };
    const result = await gradeOpenEnded(question, response);

    expect(result.grade).toBe(0);
  });

  it('never throws when Claude throws an unexpected error', async () => {
    mockResilientClaudeChat.mockRejectedValue(new Error('Network error'));

    const response: ResponseRow = { response_text: 'Some answer.', response_payload: null };
    await expect(gradeOpenEnded(question, response)).resolves.toMatchObject({ grade: 0 });
  });
});

// ── placeholder: T3 tests added in next commit ────────────────────────────────
