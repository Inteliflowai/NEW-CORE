// src/lib/engine/__tests__/quizGen.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChat = vi.fn();
vi.mock('@/lib/ai/openai', () => ({ resilientChatCompletion: (...a: unknown[]) => mockChat(...a) }));

function quizPayload(numeric: boolean) {
  const first = numeric
    ? [1, 2, 3].map(p => ({ position: p, question_type: 'numeric', question_text: `Compute ${p}`, correct_answer: '1', numeric_spec: { accepted: ['1'], tolerance: 0 }, concept_tag: 'c' }))
    : [1, 2, 3].map(p => ({ position: p, question_type: 'mcq', question_text: `Q${p}`, choices: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }, { label: 'D', text: 'd' }], correct_answer: 'A', concept_tag: 'c' }));
  const open = [4, 5].map(p => ({ position: p, question_type: 'open', question_text: `Explain ${p}`, rubric: 'A complete answer...', concept_tag: 'c' }));
  return { title: 'Quiz: Test', questions: [...first, ...open] };
}

describe('generateQuiz', () => {
  beforeEach(() => mockChat.mockReset());
  it('non-STEM → 3 MCQ + 2 open', async () => {
    mockChat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(quizPayload(false)) } }] });
    const { generateQuiz } = await import('@/lib/engine/quizGen');
    const quiz = await generateQuiz('{"subject":"History"}', 'History');
    expect(quiz.questions).toHaveLength(5);
    expect(quiz.questions.filter(q => q.question_type === 'mcq')).toHaveLength(3);
    expect(quiz.questions.filter(q => q.question_type === 'open')).toHaveLength(2);
  });
  it('STEM subject → 3 numeric + 2 open and uses the math prompt', async () => {
    mockChat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(quizPayload(true)) } }] });
    const { generateQuiz } = await import('@/lib/engine/quizGen');
    const quiz = await generateQuiz('{"subject":"Math"}', 'Math');
    expect(quiz.questions.filter(q => q.question_type === 'numeric')).toHaveLength(3);
    const userMsg = mockChat.mock.calls[0][0].messages[1].content as string;
    expect(userMsg).toContain('numeric_spec');
  });
  it('rejects a non-5-question payload (partial generation → error, §3.5)', async () => {
    const bad = quizPayload(false); bad.questions = bad.questions.slice(0, 4);
    mockChat.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(bad) } }] });
    const { generateQuiz } = await import('@/lib/engine/quizGen');
    await expect(generateQuiz('{}', 'History')).rejects.toThrow();
  });
});
