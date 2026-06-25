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
  assignments: [{ assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z', assigned_at: '2026-06-08T00:00:00Z', lesson_id: null }],
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
    assignments: [{ assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z', assigned_at: '2026-06-08T00:00:00Z', lesson_id: null }],
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
    lesson_id: `L${String(i).padStart(2, '0')}`,
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
      { assignment_key: 'k', title: 'Fractions', due_at: '2026-06-16T00:00:00Z', assigned_at: null, lesson_id: null },
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
      { assignment_key: 'k', title: 'Fractions', due_at: null, assigned_at: null, lesson_id: null },
      { ...gradedCell(0), status: 'missing', submitted_at: null, displayed_grade: null },
    );
    expect(lines.join(' ')).toMatch(/not turned in yet/i);
  });
  it('shows all three dates (Assigned · Due · Turned in) when present', () => {
    const lines = cellTooltipLines(
      { assignment_key: 'k', title: 'Fractions', due_at: '2026-06-16T00:00:00Z', assigned_at: '2026-06-14T00:00:00Z', lesson_id: null },
      gradedCell(88),
    );
    expect(lines.join(' ')).toMatch(/Assigned Jun 14/);
    expect(lines.join(' ')).toMatch(/Due Jun 16/);
    expect(lines.join(' ')).toMatch(/Turned in Jun 9/);
    for (const l of lines) expect(hasBannedWord(l)).toBe(false);
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

// ─── Task 8: Send-grades-to-Classroom batch action ───────────────────────────

/** A published-lesson column (lesson_id set, in publishedLessonIds, googleCourseId provided). */
function publishedData(overrides: { googleCourseId?: string | null; publishedLessonIds?: string[] } = {}): Gradebook {
  return {
    class_id: 'c1',
    students: [{ student_id: 's1', name: 'Ana Diaz' }],
    assignments: [{
      assignment_key: 'lesson:L99:2026-06-10',
      title: 'Poetry Unit',
      due_at: '2026-06-10T00:00:00Z',
      assigned_at: '2026-06-08T00:00:00Z',
      lesson_id: 'L99',
    }],
    cells: { s1: { 'lesson:L99:2026-06-10': gradedCell(85) } },
    class_average: 85, column_averages: { 'lesson:L99:2026-06-10': 85 }, missing_count: 0,
    quizzes: [], quiz_cells: { s1: {} },
  };
}

describe('GradebookGrid — Send grades to Classroom', () => {
  // ── Button presence ───────────────────────────────────────────────────────

  it('shows "Send grades to Classroom" on a published column (lesson_id ∈ publishedLessonIds, googleCourseId set)', () => {
    render(
      <GradebookGrid
        data={publishedData()}
        googleCourseId="gc-course-1"
        publishedLessonIds={['L99']}
      />,
    );
    expect(screen.getByRole('button', { name: /send grades to classroom/i })).toBeInTheDocument();
  });

  it('does NOT show the button when googleCourseId is null (class not connected to GC)', () => {
    render(
      <GradebookGrid
        data={publishedData()}
        googleCourseId={null}
        publishedLessonIds={['L99']}
      />,
    );
    expect(screen.queryByRole('button', { name: /send grades to classroom/i })).toBeNull();
  });

  it('does NOT show the button when the column lesson_id is not in publishedLessonIds', () => {
    render(
      <GradebookGrid
        data={publishedData()}
        googleCourseId="gc-course-1"
        publishedLessonIds={[]}
      />,
    );
    expect(screen.queryByRole('button', { name: /send grades to classroom/i })).toBeNull();
  });

  it('does NOT show the button on a column with lesson_id null (due:/id: fallback key)', () => {
    const d: Gradebook = {
      class_id: 'c1',
      students: [{ student_id: 's1', name: 'Ana Diaz' }],
      assignments: [{
        assignment_key: 'due:2026-06-10T00:00:00Z',
        title: 'Due Jun 10',
        due_at: '2026-06-10T00:00:00Z',
        assigned_at: null,
        lesson_id: null,
      }],
      cells: { s1: { 'due:2026-06-10T00:00:00Z': gradedCell(80) } },
      class_average: 80, column_averages: {}, missing_count: 0,
      quizzes: [], quiz_cells: { s1: {} },
    };
    render(
      <GradebookGrid
        data={d}
        googleCourseId="gc-course-1"
        publishedLessonIds={['some-other-lesson']}
      />,
    );
    expect(screen.queryByRole('button', { name: /send grades to classroom/i })).toBeNull();
  });

  // ── Published-flag derives from the prop (C3 prop-threading test) ──────────

  it('button appears/disappears as publishedLessonIds prop changes (toggle test)', () => {
    const { rerender } = render(
      <GradebookGrid
        data={publishedData()}
        googleCourseId="gc-course-1"
        publishedLessonIds={[]}
      />,
    );
    expect(screen.queryByRole('button', { name: /send grades to classroom/i })).toBeNull();
    rerender(
      <GradebookGrid
        data={publishedData()}
        googleCourseId="gc-course-1"
        publishedLessonIds={['L99']}
      />,
    );
    expect(screen.getByRole('button', { name: /send grades to classroom/i })).toBeInTheDocument();
  });

  // ── Click → POST → summary ────────────────────────────────────────────────

  it('clicking the button POSTs /api/teacher/google/grade-passback with {classId, lessonId}', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, pushed: 2, skipped_not_linked: 0, not_posted_in_classroom: false, errors: 0 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(
      <GradebookGrid
        data={publishedData()}
        googleCourseId="gc-course-1"
        publishedLessonIds={['L99']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /send grades to classroom/i }));

    await screen.findByText(/sent/i);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/teacher/google/grade-passback',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ classId: 'c1', lessonId: 'L99' }),
      }),
    );
  });

  it('renders quiet summary "2 sent · 0 not linked" after a successful passback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, pushed: 2, skipped_not_linked: 0, not_posted_in_classroom: false, errors: 0 }),
    }));

    render(
      <GradebookGrid
        data={publishedData()}
        googleCourseId="gc-course-1"
        publishedLessonIds={['L99']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /send grades to classroom/i }));

    expect(await screen.findByText(/2 sent/i)).toBeInTheDocument();
    expect(screen.getByText(/0 not linked/i)).toBeInTheDocument();
  });

  it('renders the not_posted_in_classroom message when the courseWork has not been posted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, pushed: 0, skipped_not_linked: 0, not_posted_in_classroom: true, errors: 0 }),
    }));

    render(
      <GradebookGrid
        data={publishedData()}
        googleCourseId="gc-course-1"
        publishedLessonIds={['L99']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /send grades to classroom/i }));

    expect(
      await screen.findByText(/post this assignment in classroom first/i),
    ).toBeInTheDocument();
  });

  it('renders a "Reconnect Google" link when needsReconnect is returned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ connected: true, needsReconnect: true }),
    }));

    render(
      <GradebookGrid
        data={publishedData()}
        googleCourseId="gc-course-1"
        publishedLessonIds={['L99']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /send grades to classroom/i }));

    const link = await screen.findByRole('link', { name: /reconnect google/i });
    expect(link).toHaveAttribute('href', '/settings/google');
  });

  // M4-fix: {connected:false} at HTTP 200 → must show Reconnect CTA, not generic error
  it('renders a "Reconnect Google" link when {connected:false} is returned (M4-fix)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ connected: false }),
    }));

    render(
      <GradebookGrid
        data={publishedData()}
        googleCourseId="gc-course-1"
        publishedLessonIds={['L99']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /send grades to classroom/i }));

    const link = await screen.findByRole('link', { name: /reconnect google/i });
    expect(link).toHaveAttribute('href', '/settings/google');
    // Must NOT show the generic error text
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  // plain failure: non-ok with no reconnect/connected fields → generic error text, NOT Reconnect
  it('renders generic error text on a plain non-ok failure with no reconnect fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'internal server error' }),
    }));

    render(
      <GradebookGrid
        data={publishedData()}
        googleCourseId="gc-course-1"
        publishedLessonIds={['L99']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /send grades to classroom/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /reconnect google/i })).toBeNull();
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
