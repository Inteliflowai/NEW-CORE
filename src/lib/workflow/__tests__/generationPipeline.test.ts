// src/lib/workflow/__tests__/generationPipeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockParse = vi.fn();
const mockQuiz = vi.fn();
vi.mock('@/lib/engine/lessonParse', () => ({ parseLesson: (...a: unknown[]) => mockParse(...a) }));
vi.mock('@/lib/engine/quizGen', () => ({ generateQuiz: (...a: unknown[]) => mockQuiz(...a) }));

describe('runGenerationPipeline (awaited default)', () => {
  beforeEach(() => { mockParse.mockReset(); mockQuiz.mockReset(); });
  it('parses then generates the quiz, in order', async () => {
    mockParse.mockResolvedValue({ subject: 'Science', title: 'Photosynthesis' });
    mockQuiz.mockResolvedValue({ title: 'Quiz', questions: new Array(5).fill({ position: 1, question_type: 'mcq', question_text: 'q' }) });
    const { runGenerationPipeline } = await import('@/lib/workflow/generationPipeline');
    const out = await runGenerationPipeline({ lessonText: 'A lesson.' });
    expect(mockParse).toHaveBeenCalledOnce();
    expect(mockQuiz).toHaveBeenCalledOnce();
    expect(out.quiz.questions).toHaveLength(5);
  });
  it('idempotency: a provided parsedLesson skips the parse step (replay-safe)', async () => {
    mockQuiz.mockResolvedValue({ title: 'Quiz', questions: new Array(5).fill({ position: 1, question_type: 'mcq', question_text: 'q' }) });
    const { runGenerationPipeline } = await import('@/lib/workflow/generationPipeline');
    await runGenerationPipeline({ lessonText: 'x', parsedLesson: { subject: 'Math', title: 'T' } as never });
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockQuiz).toHaveBeenCalledOnce();
  });
});
