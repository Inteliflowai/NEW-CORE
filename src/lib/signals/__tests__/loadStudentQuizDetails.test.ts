import { describe, it, expect, vi } from 'vitest';
import { loadStudentQuizDetails } from '../loadStudentQuizDetails';

function makeAdmin(attempts: unknown[], responses: unknown[]) {
  const attemptChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: attempts, error: null }),
  };
  const responseChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: responses, error: null }),
  };
  return {
    from: vi.fn((t: string) => (t === 'quiz_attempts' ? attemptChain : responseChain)),
  } as never;
}

describe('loadStudentQuizDetails', () => {
  it('returns empty array when student has no complete attempts', async () => {
    const data = await loadStudentQuizDetails(makeAdmin([], []), 's1');
    expect(data).toEqual([]);
  });

  it('maps attempt fields correctly', async () => {
    const attempts = [
      {
        id: 'att1', quiz_id: 'q1', score_pct: 80, mastery_band: 'grade_level',
        learning_style: 'visual', submitted_at: '2026-06-25T10:00:00Z',
        quizzes: { title: 'Fractions Quiz' },
      },
    ];
    const data = await loadStudentQuizDetails(makeAdmin(attempts, []), 's1');
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      attemptId: 'att1',
      quizTitle: 'Fractions Quiz',
      scorePct: 80,
      masteryBand: 'grade_level',
      learningStyle: 'visual',
      submittedAt: '2026-06-25T10:00:00Z',
      responses: [],
    });
  });

  it('maps MCQ response with correct_answer', async () => {
    const attempts = [
      {
        id: 'att1', quiz_id: 'q1', score_pct: 100, mastery_band: 'advanced',
        learning_style: null, submitted_at: '2026-06-25T10:00:00Z',
        quizzes: { title: 'Math Check' },
      },
    ];
    const responses = [
      {
        attempt_id: 'att1', question_id: 'qq1', response_text: '4',
        is_correct: true, ai_score: null,
        quiz_questions: {
          question_text: 'What is 2+2?', question_type: 'mcq',
          choices: ['1', '2', '4', '5'], correct_answer: '4',
        },
      },
    ];
    const data = await loadStudentQuizDetails(makeAdmin(attempts, responses), 's1');
    expect(data[0]?.responses[0]).toMatchObject({
      questionText: 'What is 2+2?',
      questionType: 'mcq',
      choices: ['1', '2', '4', '5'],
      correctAnswer: '4',
      studentAnswer: '4',
      isCorrect: true,
      aiScore: null,
    });
  });

  it('maps OEQ response with ai_score', async () => {
    const attempts = [
      {
        id: 'att1', quiz_id: 'q1', score_pct: 75, mastery_band: 'grade_level',
        learning_style: null, submitted_at: '2026-06-25T10:00:00Z',
        quizzes: { title: 'Math Check' },
      },
    ];
    const responses = [
      {
        attempt_id: 'att1', question_id: 'qq2', response_text: 'Because fractions share a denominator',
        is_correct: null, ai_score: 0.5,
        quiz_questions: {
          question_text: 'Why can you add these fractions?', question_type: 'open',
          choices: null, correct_answer: null,
        },
      },
    ];
    const data = await loadStudentQuizDetails(makeAdmin(attempts, responses), 's1');
    expect(data[0]?.responses[0]).toMatchObject({
      questionType: 'open',
      studentAnswer: 'Because fractions share a denominator',
      aiScore: 0.5,
      correctAnswer: null,
    });
  });

  it('handles null quizzes join gracefully', async () => {
    const attempts = [
      {
        id: 'att1', quiz_id: 'q1', score_pct: 60, mastery_band: 'reteach',
        learning_style: null, submitted_at: '2026-06-25T10:00:00Z',
        quizzes: null,
      },
    ];
    const data = await loadStudentQuizDetails(makeAdmin(attempts, []), 's1');
    expect(data[0]?.quizTitle).toBeNull();
  });
});
