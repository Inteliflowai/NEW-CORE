// src/lib/engine/__tests__/grading.test.ts
// TDD RED phase — these tests must fail before grading.ts is written.
//
// Covers all required cases from task-6-corrections.md:
//   1. Claude primary returns a valid grade (no GPT call).
//   2. Claude THROWS LlmExhaustedError → GPT fallback fires and returns grade (C1 throw-path).
//   3. Claude returns null → GPT fallback fires and returns grade.
//   4. Both providers THROW → gradeOpenResponse rejects with LlmExhaustedError (C1 throw-path).
//   5. Both return null → rejects with LlmExhaustedError (never fabricates a score).
//   6. Claude unparseable + GPT null → rejects (never a default object).
//   7. Claude unparseable + GPT throws → rejects with LlmExhaustedError.
//   8. rubricVersion is passed through.
//   9. claudeChat is called with CLAUDE_GRADING_MODEL in options.model (routing assertion).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';
import { CLAUDE_GRADING_MODEL } from '@/lib/ai/models';

const mockClaude = vi.fn();
const mockOpenAI = vi.fn();
vi.mock('@/lib/ai/claude', () => ({ claudeChat: (...a: unknown[]) => mockClaude(...a) }));
vi.mock('@/lib/ai/openai', () => ({ resilientChatCompletion: (...a: unknown[]) => mockOpenAI(...a) }));

// Import the module once — mocks are registered before any import runs
import { gradeOpenResponse } from '@/lib/engine/grading';

const VALID = JSON.stringify({
  score: 0.5,
  explanation: 'partial',
  confidence: 0.8,
  grader_source: 'ai',
  error_type: 'incomplete',
  reasoning_pattern: 'partial_reasoning',
  misinterpretation_detected: false,
  vocabulary_difficulty: 'low',
  cognitive_notes: 'Identifies the theme but does not connect it.',
});

describe('gradeOpenResponse', () => {
  beforeEach(() => {
    mockClaude.mockReset();
    mockOpenAI.mockReset();
  });

  // ── Case 1: Claude primary path ───────────────────────────────────────────
  it('Claude primary returns a validated grade', async () => {
    mockClaude.mockResolvedValue(VALID);
    const out = await gradeOpenResponse({ questionText: 'Q', rubric: 'R', response: 'ans' });
    expect(out.score).toBe(0.5);
    expect(out.explanation).toBe('partial');
    expect(out.grader_source).toBe('ai');
    expect(mockOpenAI).not.toHaveBeenCalled();
  });

  // ── Case 2: Claude THROWS → GPT fallback fires (C1 throw-path) ───────────
  it('Claude throws LlmExhaustedError → GPT fallback fires and returns grade', async () => {
    mockClaude.mockRejectedValue(new LlmExhaustedError('claude'));
    mockOpenAI.mockResolvedValue({ choices: [{ message: { content: VALID } }] });
    const out = await gradeOpenResponse({ questionText: 'Q', rubric: 'R', response: 'ans' });
    expect(out.score).toBe(0.5);
    expect(mockOpenAI).toHaveBeenCalledOnce();
  });

  // ── Case 3: Claude null → GPT fallback fires ──────────────────────────────
  it('Claude null → GPT fallback fires and returns grade', async () => {
    mockClaude.mockResolvedValue(null);
    mockOpenAI.mockResolvedValue({ choices: [{ message: { content: VALID } }] });
    const out = await gradeOpenResponse({ questionText: 'Q', rubric: 'R', response: 'ans' });
    expect(out.score).toBe(0.5);
    expect(mockOpenAI).toHaveBeenCalledOnce();
  });

  // ── Case 4: Both providers THROW → rejects LlmExhaustedError (C1 throw-path) ──
  it('Both providers throw → rejects with LlmExhaustedError (never fabricates a score)', async () => {
    mockClaude.mockRejectedValue(new LlmExhaustedError('claude'));
    mockOpenAI.mockRejectedValue(new LlmExhaustedError('openai'));
    await expect(
      gradeOpenResponse({ questionText: 'Q', rubric: 'R', response: 'ans' }),
    ).rejects.toMatchObject({ name: 'LlmExhaustedError' });
  });

  // ── Case 5: Both return null → rejects ────────────────────────────────────
  it('Both providers return null → rejects with LlmExhaustedError', async () => {
    mockClaude.mockResolvedValue(null);
    mockOpenAI.mockResolvedValue(null);
    await expect(
      gradeOpenResponse({ questionText: 'Q', rubric: 'R', response: 'ans' }),
    ).rejects.toMatchObject({ name: 'LlmExhaustedError' });
  });

  // ── Case 6: Unparseable Claude + null GPT → rejects (no silent default) ───
  it('Claude unparseable + GPT null → rejects (never a default object)', async () => {
    mockClaude.mockResolvedValue('not json at all');
    mockOpenAI.mockResolvedValue(null);
    await expect(
      gradeOpenResponse({ questionText: 'Q', rubric: 'R', response: 'ans' }),
    ).rejects.toThrow();
  });

  // ── Case 7: Claude unparseable + GPT throws → rejects ────────────────────
  it('Claude unparseable + GPT throws → rejects with LlmExhaustedError', async () => {
    mockClaude.mockResolvedValue('{invalid json}');
    mockOpenAI.mockRejectedValue(new LlmExhaustedError('openai'));
    await expect(
      gradeOpenResponse({ questionText: 'Q', rubric: 'R', response: 'ans' }),
    ).rejects.toMatchObject({ name: 'LlmExhaustedError' });
  });

  // ── Case 8: rubricVersion is passed through to the prompt ─────────────────
  it('passes rubricVersion to the grading prompt', async () => {
    mockClaude.mockResolvedValue(VALID);
    await gradeOpenResponse({ questionText: 'Q', rubric: 'R', response: 'ans', rubricVersion: 'v2' });
    const call = mockClaude.mock.calls[0];
    // Second arg is the userPrompt — should contain the rubric version
    expect(call[1]).toContain('v2');
  });

  // ── Case 9: claudeChat is called with CLAUDE_GRADING_MODEL (routing assertion) ──
  it('claudeChat is called with CLAUDE_GRADING_MODEL in options.model (routing assertion)', async () => {
    mockClaude.mockResolvedValue(VALID);
    await gradeOpenResponse({ questionText: 'Q', rubric: 'R', response: 'ans' });
    // 3rd arg (options) must contain model === CLAUDE_GRADING_MODEL
    const options = mockClaude.mock.calls[0][2] as { model?: string };
    expect(options?.model).toBe(CLAUDE_GRADING_MODEL);
  });
});
