// src/lib/engine/__tests__/gradeAssignment.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: vi.mock factories are hoisted above these consts, so the factory must NOT
// close over the bare `vi.fn()` ref directly (ReferenceError: cannot access before
// initialization). Wrap each in an arrow — the established pattern in grading.test.ts.
const claudeChat = vi.fn();
const resilientChatCompletion = vi.fn();
vi.mock('@/lib/ai/claude', () => ({ claudeChat: (...a: unknown[]) => claudeChat(...a) }));
vi.mock('@/lib/ai/openai', () => ({ resilientChatCompletion: (...a: unknown[]) => resilientChatCompletion(...a) }));
vi.mock('@/lib/ai/models', () => ({ CLAUDE_GRADING_MODEL: 'claude-sonnet-4-6', OPENAI_GEN_MODEL: 'gpt-4o' }));

import { gradeAssignment } from '@/lib/engine/gradeAssignment';
import { LlmExhaustedError } from '@/lib/ai/errors';

const input = {
  assignmentTitle: 'Photosynthesis',
  tasks: [{ step: 1, description: 'Explain photosynthesis' }, { step: 2, description: 'Give an example' }],
  responses: { '1': { text: 'Plants make food from light', image_url: null }, '2': { text: 'A leaf', image_url: null } },
};
const VALID = JSON.stringify({ overall_grade: 84, overall_feedback: 'Strong work.', task_grades: [{ step: 1, grade: 90, feedback: 'Clear.' }, { step: 2, grade: 78, feedback: 'Add detail.' }] });

beforeEach(() => { claudeChat.mockReset(); resilientChatCompletion.mockReset(); });

describe('gradeAssignment', () => {
  it('parses a valid Claude grade (continuous 0–100)', async () => {
    claudeChat.mockResolvedValue(VALID);
    const r = await gradeAssignment(input);
    expect(r.overall_grade).toBe(84);
    expect(r.task_grades).toHaveLength(2);
    expect(r.task_grades[0].grade).toBe(90);
  });

  it('falls back to GPT when Claude throws', async () => {
    claudeChat.mockRejectedValue(new Error('429'));
    resilientChatCompletion.mockResolvedValue({ choices: [{ message: { content: VALID } }] });
    const r = await gradeAssignment(input);
    expect(r.overall_grade).toBe(84);
  });

  it('throws LlmExhaustedError when both legs fail/unparseable (never fabricates)', async () => {
    claudeChat.mockResolvedValue('not json');
    resilientChatCompletion.mockResolvedValue({ choices: [{ message: { content: '{bad' } }] });
    await expect(gradeAssignment(input)).rejects.toBeInstanceOf(LlmExhaustedError);
  });

  it('rejects an out-of-range grade as unparseable (schema guard)', async () => {
    claudeChat.mockResolvedValue(JSON.stringify({ overall_grade: 150, overall_feedback: 'x', task_grades: [] }));
    resilientChatCompletion.mockResolvedValue({ choices: [{ message: { content: '{bad' } }] });
    await expect(gradeAssignment(input)).rejects.toBeInstanceOf(LlmExhaustedError);
  });
});
