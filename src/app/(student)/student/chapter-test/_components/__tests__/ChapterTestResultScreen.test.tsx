// @vitest-environment jsdom
import '@/test/setup-dom';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ChapterTestResultScreen } from '../ChapterTestResultScreen';

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Stub Next.js Link as a plain <a> in jsdom
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SUBMITTED_BODY = {
  status: 'submitted',
  total_grade: null,
  total_max: 60,
  forfeit_reason: null,
  sections: [],
};

const GRADED_BODY = {
  status: 'graded',
  total_grade: 47,
  total_max: 60,
  forfeit_reason: null,
  sections: [
    {
      section_order: 1,
      title: 'Reading Comprehension',
      section_grade: 12,
      section_max: 15,
      questions: [
        {
          question_order: 1,
          question_type: 'short_answer',
          question_text: 'What is the main theme?',
          points: 5,
          grade: 4,
          ai_feedback: 'Good analysis of the themes.',
          response_text: 'The theme is about friendship.',
        },
      ],
    },
  ],
};

const GRADED_TIME_UP_BODY = {
  ...GRADED_BODY,
  forfeit_reason: 'time_up',
};

/** Body where ai_feedback contains a diagnostic vocab leak ("reinforce" is in DIAGNOSTIC_VOCAB_RE). */
const GRADED_LEAKED_BODY = {
  status: 'graded',
  total_grade: 47,
  total_max: 60,
  forfeit_reason: null,
  sections: [
    {
      section_order: 1,
      title: 'Reading Comprehension',
      section_grade: 12,
      section_max: 15,
      questions: [
        {
          question_order: 1,
          question_type: 'short_answer',
          question_text: 'What is the main theme?',
          points: 5,
          grade: 4,
          ai_feedback: 'You need to reinforce your understanding of this concept.',
          response_text: 'My answer here.',
        },
      ],
    },
  ],
};

// ── Helper ─────────────────────────────────────────────────────────────────────

function stubFetch(body: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    }),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ChapterTestResultScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── 1. Grading in progress ─────────────────────────────────────────────────

  it('shows "Grading your test…" while status is submitted', async () => {
    stubFetch(SUBMITTED_BODY);
    render(<ChapterTestResultScreen attemptId="attempt-submitted" />);

    await waitFor(() => {
      expect(screen.getByText('Grading your test…')).toBeTruthy();
    });
  });

  // ── 2. Score display ───────────────────────────────────────────────────────

  it('shows "You scored 47 out of 60" when graded', async () => {
    stubFetch(GRADED_BODY);
    render(<ChapterTestResultScreen attemptId="attempt-graded" />);

    await waitFor(() => {
      expect(screen.getByText(/You scored 47 out of 60/)).toBeTruthy();
    });
  });

  // ── 3. Forfeit message ─────────────────────────────────────────────────────

  it('shows "Time was up" when forfeit_reason is time_up', async () => {
    stubFetch(GRADED_TIME_UP_BODY);
    render(<ChapterTestResultScreen attemptId="attempt-timeup" />);

    await waitFor(() => {
      expect(screen.getByText('Time was up')).toBeTruthy();
    });
  });

  // ── 4. Section accordion ───────────────────────────────────────────────────

  it('section accordion is collapsed by default; expands on click to reveal questions', async () => {
    stubFetch(GRADED_BODY);
    render(<ChapterTestResultScreen attemptId="attempt-accordion" />);

    // Wait for graded state — section title should be visible
    await waitFor(() => {
      expect(screen.getByText('Reading Comprehension')).toBeTruthy();
    });

    // Questions are hidden while collapsed
    expect(screen.queryByText('What is the main theme?')).toBeNull();

    // Expand the section by clicking its title
    fireEvent.click(screen.getByText('Reading Comprehension'));

    // Questions are now visible
    expect(screen.getByText('What is the main theme?')).toBeTruthy();
  });

  // ── 5. Four-audience leak guard ────────────────────────────────────────────

  it('substitutes the safe fallback when ai_feedback contains a diagnostic banned word', async () => {
    stubFetch(GRADED_LEAKED_BODY);
    render(<ChapterTestResultScreen attemptId="attempt-leaked" />);

    // Wait for graded state
    await waitFor(() => {
      expect(screen.getByText('Reading Comprehension')).toBeTruthy();
    });

    // Expand the section to reveal feedback
    fireEvent.click(screen.getByText('Reading Comprehension'));

    // The leaked diagnostic word MUST NOT appear anywhere in the rendered output
    expect(screen.queryByText(/reinforce/i)).toBeNull();

    // The safe fallback MUST appear in its place
    expect(
      screen.getByText(
        'Keep working on this — your teacher will share more feedback soon.',
      ),
    ).toBeTruthy();
  });

  // ── 6. Back to assignments link ────────────────────────────────────────────

  it('renders a "Back to assignments" link pointing to /student/assignments', async () => {
    stubFetch(GRADED_BODY);
    render(<ChapterTestResultScreen attemptId="attempt-link" />);

    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Back to assignments' });
      expect(link).toBeTruthy();
      expect(link.getAttribute('href')).toBe('/student/assignments');
    });
  });
});
