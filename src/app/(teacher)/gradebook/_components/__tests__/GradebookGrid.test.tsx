// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import { GradebookGrid, cellTooltipLines, DEFAULT_VISIBLE_COLS } from '../GradebookGrid';
import type { Gradebook, GradebookCell } from '@/lib/gradebook/loadGradebook';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const data: Gradebook = {
  class_id: 'c1',
  students: [{ student_id: 's1', name: 'Ana Diaz' }, { student_id: 's2', name: 'Ben Cole' }],
  assignments: [{ assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z', assigned_at: '2026-06-08T00:00:00Z' }],
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
    assignments: [{ assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z', assigned_at: '2026-06-08T00:00:00Z' }],
    cells: { s1: { 'due:d1': cell } },
    class_average: cell.displayed_grade, column_averages: { 'due:d1': cell.displayed_grade }, missing_count: 0,
    quizzes: [], quiz_cells: { s1: {} },
  };
}

function gradedCell(grade: number, over: Partial<GradebookCell> = {}): GradebookCell {
  return {
    attempt_id: 'h1', status: 'graded', displayed_grade: grade, score_pct: grade,
    effort_label: null, teacher_notes: null, submitted_at: '2026-06-09T00:00:00Z',
    is_override: false, submitted_on_time: true, allow_redo: false, ...over,
  };
}

function makeData(nCols: number): Gradebook {
  const assignments = Array.from({ length: nCols }, (_, i) => ({
    assignment_key: `lesson:L:${String(i).padStart(2, '0')}`,
    title: `Lesson ${i}`,
    due_at: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    assigned_at: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  }));
  const cells: Gradebook['cells'] = { s1: {} };
  for (const a of assignments) cells.s1[a.assignment_key] = gradedCell(80);
  return {
    class_id: 'c1', students: [{ student_id: 's1', name: 'Ana Diaz' }],
    assignments, cells, class_average: 80, column_averages: {}, missing_count: 0,
    quizzes: [], quiz_cells: {},
  };
}

beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })); });

describe('GradebookGrid', () => {
  it('renders a glyph AND grade for graded, and the miss label for missing', () => {
    render(<GradebookGrid data={data} />);
    // Scope to the grid (the glyph legend below also carries these glyphs/words).
    const grid = within(screen.getByRole('table'));
    expect(grid.getByText(/88/)).toBeInTheDocument();          // grade digit
    expect(grid.getByText('✓')).toBeInTheDocument();           // graded glyph
    expect(grid.getByText(/miss/i)).toBeInTheDocument();       // missing label (not color-only)
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
    // Scope to the grid (the legend also lists a "late" row).
    expect(within(screen.getByRole('table')).getByText(/late/i)).toBeInTheDocument();
  });

  // M7 — redo_in_progress shows the ⟳ glyph AND retains the prior grade.
  it('renders the redo glyph and the retained prior grade for redo_in_progress', () => {
    render(<GradebookGrid data={oneCell({ attempt_id: 'h1', status: 'redo_in_progress', displayed_grade: 80, score_pct: 80, effort_label: null, teacher_notes: null, submitted_at: null, is_override: false, submitted_on_time: true, allow_redo: false })} />);
    // Scope to the grid (the legend also carries the ⟳ glyph).
    const grid = within(screen.getByRole('table'));
    expect(grid.getByText('⟳')).toBeInTheDocument();          // redo glyph
    expect(grid.getByText(/80/)).toBeInTheDocument();          // prior grade still shown
  });

  // M7 — clicking an interactive cell opens the drill-in panel.
  it('clicking a cell opens the drill-in dialog', () => {
    render(<GradebookGrid data={data} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ana Diaz.*Due Jun 10/i }));
    expect(screen.getByRole('dialog', { name: /Ana Diaz.*Due Jun 10/i })).toBeInTheDocument();
  });

  // B-A1 — the cell's accessible name folds in late / override / redo state (no banned words).
  it('appends ", late" to the aria-label of a late cell', () => {
    render(<GradebookGrid data={oneCell({ attempt_id: 'h1', status: 'graded', displayed_grade: 80, score_pct: 80, effort_label: null, teacher_notes: null, submitted_at: null, is_override: false, submitted_on_time: false, allow_redo: false })} />);
    const btn = screen.getByRole('button', { name: /Ana Diaz.*Due Jun 10/i });
    expect(btn.getAttribute('aria-label')).toMatch(/late/i);
    expect(hasBannedWord(btn.getAttribute('aria-label') || '')).toBe(false);
  });
  it('appends ", grade changed by teacher" to the aria-label of an overridden cell', () => {
    render(<GradebookGrid data={oneCell({ attempt_id: 'h1', status: 'graded', displayed_grade: 90, score_pct: 70, effort_label: null, teacher_notes: null, submitted_at: null, is_override: true, submitted_on_time: true, allow_redo: false })} />);
    const btn = screen.getByRole('button', { name: /Ana Diaz.*Due Jun 10/i });
    expect(btn.getAttribute('aria-label')).toMatch(/grade changed by teacher/i);
  });
  it('appends ", redo open" to the aria-label of a redo_in_progress cell', () => {
    render(<GradebookGrid data={oneCell({ attempt_id: 'h1', status: 'redo_in_progress', displayed_grade: 80, score_pct: 80, effort_label: null, teacher_notes: null, submitted_at: null, is_override: false, submitted_on_time: true, allow_redo: false })} />);
    const btn = screen.getByRole('button', { name: /Ana Diaz.*Due Jun 10/i });
    expect(btn.getAttribute('aria-label')).toMatch(/redo open/i);
  });

  // B-U6 — a submitted cell renders a visible word beside the ⋯ glyph.
  it('shows a visible word for a submitted cell (not a bare glyph)', () => {
    render(<GradebookGrid data={oneCell({ attempt_id: 'h2', status: 'submitted', displayed_grade: null, score_pct: null, effort_label: null, teacher_notes: null, submitted_at: '2026-06-09T00:00:00Z', is_override: false, submitted_on_time: true, allow_redo: false })} />);
    // "in" next to the glyph (whole-word match so it doesn't catch "Diaz"/etc).
    expect(screen.getByText(/^in$/i)).toBeInTheDocument();
  });

  // B-U2 — a glyph legend maps each glyph to its leak-guarded word.
  it('renders a glyph legend mapping glyphs to words (no banned words)', () => {
    render(<GradebookGrid data={data} />);
    const legend = screen.getByTestId('glyph-legend');
    expect(legend).toBeInTheDocument();
    expect(legend.textContent || '').toMatch(/graded/i);
    expect(legend.textContent || '').toMatch(/missing/i);
    expect(hasBannedWord(legend.textContent || '')).toBe(false);
  });
});

describe('cellTooltipLines', () => {
  it('shows assignment name + submitted date + due, banned-word-free', () => {
    const lines = cellTooltipLines(
      { assignment_key: 'k', title: 'Fractions', due_at: '2026-06-16T00:00:00Z', assigned_at: null },
      gradedCell(88, { submitted_on_time: false }),
    );
    expect(lines[0]).toBe('Fractions');
    expect(lines.join(' ')).toMatch(/Turned in Jun 9/);
    expect(lines.join(' ')).toMatch(/late/i);
    expect(lines.join(' ')).toMatch(/Due Jun 16/);
    for (const l of lines) expect(hasBannedWord(l)).toBe(false);
  });
  it('says not turned in yet when there is no submission', () => {
    const lines = cellTooltipLines(
      { assignment_key: 'k', title: 'Fractions', due_at: null, assigned_at: null },
      { ...gradedCell(0), status: 'missing', submitted_at: null, displayed_grade: null },
    );
    expect(lines.join(' ')).toMatch(/not turned in yet/i);
  });
});

describe('GradebookGrid — windowing', () => {
  it('shows only the most-recent DEFAULT_VISIBLE_COLS columns, newest visible; expands on Show earlier', () => {
    expect(DEFAULT_VISIBLE_COLS).toBe(12);
    render(<GradebookGrid data={makeData(15)} />);
    // 15 cols, default window 12 → "Lesson 0/1/2" (oldest) hidden until expanded.
    expect(screen.queryByText('Lesson 0')).toBeNull();
    expect(screen.getByText('Lesson 14')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show earlier/i }));
    expect(screen.getByText('Lesson 0')).toBeInTheDocument();
  });
  it('does NOT show the Show earlier control when columns fit the window', () => {
    render(<GradebookGrid data={makeData(5)} />);
    expect(screen.queryByRole('button', { name: /show earlier/i })).toBeNull();
  });
  it('renders the assigned/due dates in the column header', () => {
    render(<GradebookGrid data={makeData(2)} />);
    expect(screen.getAllByText(/Assigned Jun|Due Jun/).length).toBeGreaterThan(0);
  });
});

describe('GradebookGrid — cell tooltip a11y', () => {
  // Whole-branch review (a11y lens): the date detail must reach AT users (not only sighted hover),
  // and the tooltip must be Escape-dismissible (WCAG 1.4.13).
  it('folds the submitted + due dates into the cell aria-label (screen-reader path)', () => {
    render(<GradebookGrid data={data} />);
    const btn = screen.getByRole('button', { name: /Ana Diaz.*Due Jun 10/i });
    const label = btn.getAttribute('aria-label') || '';
    expect(label).toMatch(/Turned in Jun 9/);
    expect(label).toMatch(/Due Jun 10/);
    expect(hasBannedWord(label)).toBe(false);
  });
  it('opens the tooltip on focus and dismisses it on Escape (WCAG 1.4.13)', () => {
    render(<GradebookGrid data={data} />);
    const btn = screen.getByRole('button', { name: /Ana Diaz.*Due Jun 10/i });
    fireEvent.focus(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
