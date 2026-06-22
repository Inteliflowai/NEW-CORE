// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import { GradebookGrid } from '../GradebookGrid';
import type { Gradebook, GradebookCell } from '@/lib/gradebook/loadGradebook';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const data: Gradebook = {
  class_id: 'c1',
  students: [{ student_id: 's1', name: 'Ana Diaz' }, { student_id: 's2', name: 'Ben Cole' }],
  assignments: [{ assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z' }],
  cells: {
    s1: { 'due:d1': { attempt_id: 'h1', status: 'graded', displayed_grade: 88, score_pct: 88, effort_label: null, teacher_notes: null, submitted_at: '2026-06-09T00:00:00Z', is_override: false, submitted_on_time: true, allow_redo: false } },
    s2: { 'due:d1': { attempt_id: null, status: 'missing', displayed_grade: null, score_pct: null, effort_label: null, teacher_notes: null, submitted_at: null, is_override: false, submitted_on_time: null, allow_redo: false } },
  },
  class_average: 88, column_averages: { 'due:d1': 88 }, missing_count: 1,
  quizzes: [], quiz_cells: { s1: {}, s2: {} },
};

/** A single-student, single-column gradebook with one cell overridden for focused assertions. */
function oneCell(cell: GradebookCell): Gradebook {
  return {
    class_id: 'c1',
    students: [{ student_id: 's1', name: 'Ana Diaz' }],
    assignments: [{ assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z' }],
    cells: { s1: { 'due:d1': cell } },
    class_average: cell.displayed_grade, column_averages: { 'due:d1': cell.displayed_grade }, missing_count: 0,
    quizzes: [], quiz_cells: { s1: {} },
  };
}

beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })); });

describe('GradebookGrid', () => {
  it('renders a glyph AND grade for graded, and the miss label for missing', () => {
    render(<GradebookGrid data={data} />);
    expect(screen.getByText(/88/)).toBeInTheDocument();          // grade digit
    expect(screen.getByText('✓')).toBeInTheDocument();           // graded glyph
    expect(screen.getByText(/miss/i)).toBeInTheDocument();       // missing label (not color-only)
  });
  it('every graded/missing cell is a button with an aria-label (WCAG, not color-only)', () => {
    render(<GradebookGrid data={data} />);
    const cellBtn = screen.getByRole('button', { name: /Ana Diaz.*Due Jun 10/i });
    expect(cellBtn).toBeInTheDocument();
  });
  it('renders the class-average footer and a missing-work summary with no banned words', () => {
    render(<GradebookGrid data={data} />);
    expect(screen.getByText(/Class average/i)).toBeInTheDocument();
    const summary = screen.getByTestId('missing-summary').textContent || '';
    expect(hasBannedWord(summary)).toBe(false); // count-bearing → hasBannedWord, NOT hasLeak
  });

  // M7 — an overridden cell shows the override marker.
  it('shows an override marker on an overridden cell', () => {
    render(<GradebookGrid data={oneCell({ attempt_id: 'h1', status: 'graded', displayed_grade: 90, score_pct: 70, effort_label: null, teacher_notes: null, submitted_at: null, is_override: true, submitted_on_time: true, allow_redo: false })} />);
    expect(screen.getByTitle(/overridden/i)).toBeInTheDocument();
  });

  // M7 — a late (submitted_on_time:false) cell shows a "late" node (not color alone).
  it('shows a "late" badge when submitted_on_time is false', () => {
    render(<GradebookGrid data={oneCell({ attempt_id: 'h1', status: 'graded', displayed_grade: 80, score_pct: 80, effort_label: null, teacher_notes: null, submitted_at: null, is_override: false, submitted_on_time: false, allow_redo: false })} />);
    expect(screen.getByText(/late/i)).toBeInTheDocument();
  });

  // M7 — redo_in_progress shows the ⟳ glyph AND retains the prior grade.
  it('renders the redo glyph and the retained prior grade for redo_in_progress', () => {
    render(<GradebookGrid data={oneCell({ attempt_id: 'h1', status: 'redo_in_progress', displayed_grade: 80, score_pct: 80, effort_label: null, teacher_notes: null, submitted_at: null, is_override: false, submitted_on_time: true, allow_redo: false })} />);
    expect(screen.getByText('⟳')).toBeInTheDocument();          // redo glyph
    expect(screen.getByText(/80/)).toBeInTheDocument();          // prior grade still shown
  });

  // M7 — clicking an interactive cell opens the drill-in panel.
  it('clicking a cell opens the drill-in dialog', () => {
    render(<GradebookGrid data={data} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ana Diaz.*Due Jun 10/i }));
    expect(screen.getByRole('dialog', { name: /Ana Diaz.*Due Jun 10/i })).toBeInTheDocument();
  });
});
