// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import { GradebookGrid } from '../GradebookGrid';
import type { Gradebook } from '@/lib/gradebook/loadGradebook';

const data: Gradebook = {
  class_id: 'c1',
  students: [{ student_id: 's1', name: 'Ana Diaz' }, { student_id: 's2', name: 'Ben Cole' }],
  assignments: [{ assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z' }],
  cells: {
    s1: { 'due:d1': { attempt_id: 'h1', status: 'graded', displayed_grade: 88, is_override: false, submitted_on_time: true, allow_redo: false } },
    s2: { 'due:d1': { attempt_id: null, status: 'missing', displayed_grade: null, is_override: false, submitted_on_time: null, allow_redo: false } },
  },
  class_average: 88, column_averages: { 'due:d1': 88 }, missing_count: 1,
  quizzes: [], quiz_cells: { s1: {}, s2: {} },
};

describe('GradebookGrid', () => {
  it('renders a glyph AND grade for graded, and the miss label for missing', () => {
    render(<GradebookGrid data={data} classId="c1" />);
    expect(screen.getByText(/88/)).toBeInTheDocument();          // grade digit
    expect(screen.getByText('✓')).toBeInTheDocument();           // graded glyph
    expect(screen.getByText(/miss/i)).toBeInTheDocument();       // missing label (not color-only)
  });
  it('every graded/missing cell is a button with an aria-label (WCAG, not color-only)', () => {
    render(<GradebookGrid data={data} classId="c1" />);
    const cellBtn = screen.getByRole('button', { name: /Ana Diaz.*Due Jun 10/i });
    expect(cellBtn).toBeInTheDocument();
  });
  it('renders the class-average footer and a missing-work summary with no banned words', () => {
    render(<GradebookGrid data={data} classId="c1" />);
    expect(screen.getByText(/Class average/i)).toBeInTheDocument();
    const summary = screen.getByTestId('missing-summary').textContent || '';
    expect(hasBannedWord(summary)).toBe(false); // count-bearing → hasBannedWord, NOT hasLeak
  });
});
