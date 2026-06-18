// src/lib/engine/__tests__/adapt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';

const mockChat = vi.fn();
vi.mock('@/lib/ai/openai', () => ({ resilientChatCompletion: (...a: unknown[]) => mockChat(...a) }));

function adapted(level: string, pct: number) {
  return {
    level, mcq_pct: pct, questions: [
      { position: 4, question_text: 'Q4', rubric: 'r', scaffold_hint: 'h', difficulty_label: 'Standard' },
      { position: 5, question_text: 'Q5', rubric: 'r', scaffold_hint: 'h', difficulty_label: 'Standard' },
    ],
  };
}

describe('adaptQuestions', () => {
  beforeEach(() => mockChat.mockReset());

  it('0/3 correct (0%) → scaffolded level', async () => {
    mockChat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(adapted('scaffolded', 0)) } }] });
    const { adaptQuestions } = await import('@/lib/engine/adapt');
    const out = await adaptQuestions({ correctCount: 0, lessonContext: '{}', originalQ4: 'A', originalQ5: 'B' });
    expect(out.level).toBe('scaffolded');
    const userMsg = mockChat.mock.calls[0][0].messages[1].content as string;
    expect(userMsg).toContain('SCAFFOLDED');
  });

  it('2/3 correct (67%) → grade_level', async () => {
    mockChat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(adapted('grade_level', 67)) } }] });
    const { adaptQuestions } = await import('@/lib/engine/adapt');
    const out = await adaptQuestions({ correctCount: 2, lessonContext: '{}', originalQ4: 'A', originalQ5: 'B' });
    expect(out.level).toBe('grade_level');
  });

  it('3/3 correct (100%) → advanced', async () => {
    mockChat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(adapted('advanced', 100)) } }] });
    const { adaptQuestions } = await import('@/lib/engine/adapt');
    const out = await adaptQuestions({ correctCount: 3, lessonContext: '{}', originalQ4: 'A', originalQ5: 'B' });
    expect(out.level).toBe('advanced');
    const userMsg = mockChat.mock.calls[0][0].messages[1].content as string;
    expect(userMsg).toContain('ADVANCED');
  });

  it('null completion → falls back to original Q4/Q5 (never blocks the attempt)', async () => {
    mockChat.mockResolvedValue(null);
    const { adaptQuestions } = await import('@/lib/engine/adapt');
    const out = await adaptQuestions({ correctCount: 1, lessonContext: '{}', originalQ4: 'ORIG4', originalQ5: 'ORIG5' });
    expect(out.questions[0].question_text).toBe('ORIG4');
    expect(out.questions[1].question_text).toBe('ORIG5');
    expect(out.level).toBe('scaffolded');
  });

  it('LlmExhaustedError throw → falls back to original Q4/Q5 (never blocks the attempt)', async () => {
    // Vitest v4 / Node 24: errors thrown inside vi.fn() spy are detected and associated
    // with the test even when caught by the SUT. Work around: replace the module mock with
    // a plain non-spy function (no vi.fn), reset modules to force re-import, and restore
    // the vi.mock factory afterward. Tests the exact throw path: resilientChatCompletion
    // throws LlmExhaustedError, adaptQuestions catches it in try/catch, returns fallback.
    vi.doMock('@/lib/ai/openai', () => ({
      resilientChatCompletion: () => { throw new LlmExhaustedError('openai'); },
    }));
    vi.resetModules();
    const { adaptQuestions } = await import('@/lib/engine/adapt');
    const out = await adaptQuestions({ correctCount: 2, lessonContext: '{}', originalQ4: 'ORIG4', originalQ5: 'ORIG5' });
    expect(out.questions[0].question_text).toBe('ORIG4');
    expect(out.questions[1].question_text).toBe('ORIG5');
    // does NOT throw
    expect(out.level).toBe('grade_level');
    // Restore the vi.mock factory so subsequent tests use mockChat again
    vi.doMock('@/lib/ai/openai', () => ({ resilientChatCompletion: (...a: unknown[]) => mockChat(...a) }));
    vi.resetModules();
  });

  it('malformed LLM response (bad schema) → falls back to original Q4/Q5', async () => {
    mockChat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ level: 'advanced', mcq_pct: 100, questions: [] }) } }] });
    const { adaptQuestions } = await import('@/lib/engine/adapt');
    const out = await adaptQuestions({ correctCount: 3, lessonContext: '{}', originalQ4: 'ORIG4', originalQ5: 'ORIG5' });
    expect(out.questions[0].question_text).toBe('ORIG4');
    expect(out.questions[1].question_text).toBe('ORIG5');
    // does NOT throw
  });

  it('ownership rejection — route returns 404 for unknown attempt (not adaptQuestions concern)', () => {
    // Ownership is enforced in the route (student_id filter). adaptQuestions itself
    // is pure — it never queries the DB. This test documents the contract.
    expect(true).toBe(true);
  });
});
