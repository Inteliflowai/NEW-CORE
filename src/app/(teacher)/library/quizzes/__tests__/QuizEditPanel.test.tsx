// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/library/quizzes',
}));

import QuizLibrary from '../_components/QuizLibrary';

const QUIZ = {
  id: 'q1',
  title: 'Week 3 Check',
  status: 'draft' as const,
  question_count: 2,
  published_at: null,
  lesson_title: null,
  subject: 'Science',
  grade_level: '5',
  created_at: '2026-06-29T00:00:00Z',
};

const MCQ_QUESTION = {
  id: 'qq1',
  position: 1,
  question_type: 'mcq',
  question_text: 'What is 2+2?',
  choices: ['1', '2', '4', '5'],
  rubric: null,
  correct_answer: '4',
};

describe('QuizEditPanel — correct_answer display', () => {
  it('renders the correct answer for an MCQ question in the edit panel', async () => {
    render(
      React.createElement(QuizLibrary, {
        data: { class_id: 'c1', quizzes: [QUIZ] },
        classId: 'c1',
        questions: { q1: [MCQ_QUESTION] },
      }),
    );

    // Click on the quiz to open the edit panel
    const quizButton = screen.getByRole('button', { name: /Week 3 Check/i });
    fireEvent.click(quizButton);

    // Wait for the edit panel to appear and verify correct_answer is rendered
    await waitFor(() => {
      expect(screen.getByText(/Correct answer: 4/)).toBeInTheDocument();
    });
  });
});
