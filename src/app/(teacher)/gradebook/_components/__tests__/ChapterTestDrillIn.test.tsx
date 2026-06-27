// @vitest-environment jsdom
import '@/test/setup-dom';
// src/app/(teacher)/gradebook/_components/__tests__/ChapterTestDrillIn.test.tsx
// Tests for ChapterTestDrillIn — the teacher-only per-student chapter test breakdown panel.
// This is a TEACHER-ONLY surface (raw numbers allowed). Four-audience: no band/CL/risk.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChapterTestDrillIn } from '../ChapterTestDrillIn';
import type { ChapterTestCell } from '@/lib/gradebook/loadGradebook';

// ── Fixture data ───────────────────────────────────────────────────────────────────────────────
const cell: ChapterTestCell = {
  attempt_id: 'at1',
  status: 'graded',
  total_grade: 47,
  total_max: 60,
};

const defaultProps = {
  chapterTestId: 'ct1',
  chapterTitle: 'Chapter 1: The Renaissance',
  testTitle: 'Chapter 1 Test',
  studentId: 's1',
  studentName: 'Ana Diaz',
  classId: 'c1',
  cell,
  onClose: vi.fn(),
};

const apiResponse = {
  attempt_id: 'at1',
  status: 'graded',
  total_grade: 47,
  total_max: 60,
  sections: [
    {
      section_order: 1,
      section_kind: 'vocabulary',
      title: 'Vocabulary',
      time_minutes: 8,
      total_points: 10,
      questions: [
        {
          question_order: 1,
          question_type: 'mcq',
          question_text: 'What is a simile?',
          points: 5,
          response_text: 'A comparison using like or as',
          response_payload: null,
          grade: 5,
          ai_feedback: 'Correct.',
        },
      ],
    },
    {
      section_order: 2,
      section_kind: 'short_answer',
      title: 'Short Answer',
      time_minutes: 10,
      total_points: 15,
      questions: [
        {
          question_order: 1,
          question_type: 'short_answer',
          question_text: 'Describe the Medici family.',
          points: 10,
          response_text: 'A wealthy banking family from Florence.',
          response_payload: null,
          grade: 8,
          ai_feedback: 'Good, but needs more detail.',
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => apiResponse,
    }),
  );
});

describe('ChapterTestDrillIn', () => {
  // ── Loading state ────────────────────────────────────────────────────────────────────────────
  it('renders a loading indicator before fetch resolves', () => {
    // Make fetch never resolve
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<ChapterTestDrillIn {...defaultProps} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  // ── Data display ─────────────────────────────────────────────────────────────────────────────
  it('shows student name and test title after fetch resolves', async () => {
    render(<ChapterTestDrillIn {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Ana Diaz')).toBeInTheDocument());
    expect(screen.getByText(/Chapter 1 Test/)).toBeInTheDocument();
  });

  it('shows total_grade / total_max after fetch resolves (teacher-surface numbers)', async () => {
    render(<ChapterTestDrillIn {...defaultProps} />);
    await waitFor(() => expect(screen.getByText(/47/)).toBeInTheDocument());
    expect(screen.getByText(/60/)).toBeInTheDocument();
  });

  it('shows a status badge after fetch resolves', async () => {
    render(<ChapterTestDrillIn {...defaultProps} />);
    await waitFor(() => expect(screen.getByText(/graded/i)).toBeInTheDocument());
  });

  // ── Collapsible sections ──────────────────────────────────────────────────────────────────────
  it('sections render with their titles visible after fetch', async () => {
    render(<ChapterTestDrillIn {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Vocabulary')).toBeInTheDocument());
    expect(screen.getByText('Short Answer')).toBeInTheDocument();
  });

  it('question text is not visible when section is collapsed', async () => {
    render(<ChapterTestDrillIn {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Vocabulary')).toBeInTheDocument());
    // Questions not visible before expand
    expect(screen.queryByText('What is a simile?')).not.toBeInTheDocument();
  });

  it('clicking a section header expands it to show questions', async () => {
    render(<ChapterTestDrillIn {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Vocabulary')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Vocabulary'));
    expect(screen.getByText('What is a simile?')).toBeInTheDocument();
    expect(screen.getByText('A comparison using like or as')).toBeInTheDocument();
    expect(screen.getByText('Correct.')).toBeInTheDocument();
  });

  it('clicking the same section again collapses it', async () => {
    render(<ChapterTestDrillIn {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Vocabulary')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Vocabulary'));
    expect(screen.getByText('What is a simile?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Vocabulary'));
    expect(screen.queryByText('What is a simile?')).not.toBeInTheDocument();
  });

  it('section-level grade shown in collapsed header (sum of question grades)', async () => {
    render(<ChapterTestDrillIn {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Vocabulary')).toBeInTheDocument());
    // Section 1: 5/10, Section 2: 8/15
    expect(screen.getByText('5 / 10')).toBeInTheDocument();
    expect(screen.getByText('8 / 15')).toBeInTheDocument();
  });

  // ── Keyboard / a11y ──────────────────────────────────────────────────────────────────────────
  it('Escape key calls onClose', async () => {
    const onClose = vi.fn();
    render(<ChapterTestDrillIn {...defaultProps} onClose={onClose} />);
    // Panel is present immediately (before fetch)
    const panel = screen.getByRole('dialog');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // ── Backdrop ─────────────────────────────────────────────────────────────────────────────────
  it('backdrop click calls onClose', () => {
    const onClose = vi.fn();
    render(<ChapterTestDrillIn {...defaultProps} onClose={onClose} />);
    const backdrop = screen.getByTestId('chapter-drill-in-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  // ── Fetch URL ─────────────────────────────────────────────────────────────────────────────────
  it('fetches the correct endpoint on mount', async () => {
    render(<ChapterTestDrillIn {...defaultProps} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('chapterTestId=ct1');
    expect(url).toContain('studentId=s1');
  });
});
