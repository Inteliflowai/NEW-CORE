// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiagnosticChecksSection } from '../DiagnosticChecksSection';
import type { Gradebook } from '@/lib/gradebook/loadGradebook';

const data: Gradebook = {
  class_id: 'c1',
  students: [{ student_id: 's1', name: 'Ana Diaz' }],
  assignments: [], cells: {}, class_average: null, column_averages: {}, missing_count: 0,
  quizzes: [{ quiz_id: 'q1', label: 'Demo Quiz' }],
  quiz_cells: { s1: { q1: { quiz_attempt_id: 'qa1', is_complete: true, score_pct: 88, mastery_band: 'grade_level' } } },
};

describe('DiagnosticChecksSection', () => {
  it('renders the "not graded" label and the quiz column header', () => {
    render(<DiagnosticChecksSection data={data} />);
    expect(screen.getByText(/Diagnostic checks — not graded/i)).toBeInTheDocument();
    expect(screen.getByText('Demo Quiz')).toBeInTheDocument();
  });
  it('has NO override controls (quiz cells are read-only)', () => {
    render(<DiagnosticChecksSection data={data} />);
    expect(screen.queryByRole('button', { name: /override|another try|save/i })).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull(); // no numeric grade input
  });
  it('never renders the raw mastery_band enum string', () => {
    render(<DiagnosticChecksSection data={data} />);
    expect(screen.queryByText('grade_level')).toBeNull(); // raw enum must be humanized via MasteryLabel
  });
});
