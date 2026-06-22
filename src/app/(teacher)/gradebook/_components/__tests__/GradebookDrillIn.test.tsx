// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GradebookDrillIn } from '../GradebookDrillIn';
import { effortLabelPhrase } from '@/lib/copy/effortLabelPhrase';
import { EFFORT_LABELS } from '@/lib/signals/computeEffortLabel';
import { hasBannedWord } from '@/lib/copy/leakGuard';

const selected = {
  studentName: 'Ana Diaz',
  col: { assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z' },
  cell: { attempt_id: 'h1', status: 'graded' as const, displayed_grade: 90, effort_label: null, teacher_notes: null, submitted_at: '2026-06-09T00:00:00Z', is_override: true, submitted_on_time: true, allow_redo: false, score_pct: 70 },
};

beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, displayed_grade: 95 }) })); });

describe('GradebookDrillIn', () => {
  it('shows the AI-vs-teacher grade breakdown when an override exists', () => {
    render(<GradebookDrillIn selected={selected} onClose={() => {}} onWrite={() => {}} />);
    expect(screen.getByText(/Ana Diaz/)).toBeInTheDocument();
    expect(screen.getByText(/AI grade/i)).toBeInTheDocument();   // 70
    expect(screen.getByText(/Your grade/i)).toBeInTheDocument(); // 90
  });
  it('submitting an override POSTs teacher_score then calls onWrite', async () => {
    const onWrite = vi.fn();
    render(<GradebookDrillIn selected={selected} onClose={() => {}} onWrite={onWrite} />);
    fireEvent.change(screen.getByLabelText(/grade/i), { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((fetch as unknown as { mock: { calls: Array<[unknown, { body: string }]> } }).mock.calls[0][1].body);
    expect(body.attempt_id).toBe('h1'); expect(body.teacher_score).toBe(95);
    await waitFor(() => expect(onWrite).toHaveBeenCalled());
  });

  // I4 — the effort line renders the real phrase for each of the four effort-label values.
  it('renders the effort phrase for every effort_label value', () => {
    for (const label of EFFORT_LABELS) {
      const phrase = effortLabelPhrase(label)!;
      const { unmount } = render(
        <GradebookDrillIn
          selected={{ ...selected, cell: { ...selected.cell, effort_label: label } }}
          onClose={() => {}} onWrite={() => {}}
        />,
      );
      expect(screen.getByText(phrase), label).toBeInTheDocument();
      unmount();
    }
  });
  it('renders no effort line when effort_label is null', () => {
    render(<GradebookDrillIn selected={selected} onClose={() => {}} onWrite={() => {}} />);
    for (const label of EFFORT_LABELS) {
      expect(screen.queryByText(effortLabelPhrase(label)!)).toBeNull();
    }
  });

  // Finding 1 — a graded cell with NO existing override starts with a blank grade input.
  // Editing ONLY the note (grade left blank) must SAVE the note: POST carries teacher_notes and
  // NO teacher_score key, with no inline error (a blank grade = "no grade change", not an error).
  it('allows a note-only save on a graded cell with no override — POSTs teacher_notes, no teacher_score, no error', async () => {
    const onWrite = vi.fn();
    render(<GradebookDrillIn selected={{ ...selected, cell: { ...selected.cell, is_override: false, displayed_grade: 70 } }} onClose={() => {}} onWrite={onWrite} />);
    // Grade input starts empty for a non-override cell; edit only the note.
    fireEvent.change(screen.getByLabelText(/add a note/i), { target: { value: 'great effort' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((fetch as unknown as { mock: { calls: Array<[unknown, { body: string }]> } }).mock.calls[0][1].body);
    expect(body.teacher_notes).toBe('great effort');
    expect('teacher_score' in body).toBe(false); // blank grade → no grade change sent
    expect(screen.queryByRole('alert')).toBeNull(); // no inline error
    await waitFor(() => expect(onWrite).toHaveBeenCalled());
  });
  it('blocks save on an out-of-range grade — shows an inline error, does NOT POST', async () => {
    render(<GradebookDrillIn selected={selected} onClose={() => {}} onWrite={() => {}} />);
    fireEvent.change(screen.getByLabelText(/grade/i), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/grade from 0 to 100/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  // M4 — Escape closes the panel (keyboard a11y).
  it('Escape closes the panel', () => {
    const onClose = vi.fn();
    render(<GradebookDrillIn selected={selected} onClose={onClose} onWrite={() => {}} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // B-C1 — the grade-override input shows ONLY for graded-family statuses.
  it('a graded cell shows the grade-override input, Save and Clear', () => {
    render(<GradebookDrillIn selected={selected} onClose={() => {}} onWrite={() => {}} />);
    expect(screen.getByLabelText(/grade/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear override/i })).toBeInTheDocument();
  });
  it('a submitted (ungraded) cell shows notes only — NO grade input, NO reteach toggle, with a "not graded yet" line', () => {
    const submittedSel = { ...selected, cell: { ...selected.cell, status: 'submitted' as const, attempt_id: 'h2', displayed_grade: null, score_pct: null, is_override: false } };
    render(<GradebookDrillIn selected={submittedSel} onClose={() => {}} onWrite={() => {}} />);
    expect(screen.queryByLabelText(/grade/i)).toBeNull();          // no grade input
    expect(screen.queryByRole('spinbutton')).toBeNull();           // no numeric input
    // Finding 2 — submitted (ungraded) work can't be reteached; the toggle must NOT render.
    expect(screen.queryByRole('checkbox', { name: /another try/i })).toBeNull();
    expect(screen.getByText(/not graded yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/add a note/i)).toBeInTheDocument(); // notes still editable
  });
  it('a missing cell (no attempt) shows an explanatory empty-state and NO write controls', () => {
    const missingSel = { ...selected, cell: { ...selected.cell, status: 'missing' as const, attempt_id: null, displayed_grade: null, score_pct: null, is_override: false } };
    render(<GradebookDrillIn selected={missingSel} onClose={() => {}} onWrite={() => {}} />);
    expect(screen.queryByLabelText(/grade/i)).toBeNull();
    expect(screen.queryByLabelText(/add a note/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
    expect(screen.getByText(/nothing'?s been turned in/i)).toBeInTheDocument();
  });

  // B-U5 — the notes textarea seeds from cell.teacher_notes and an emptied note clears (null).
  it('seeds the notes textarea from an existing teacher_notes', () => {
    const noted = { ...selected, cell: { ...selected.cell, teacher_notes: 'keep going' } };
    render(<GradebookDrillIn selected={noted} onClose={() => {}} onWrite={() => {}} />);
    expect(screen.getByLabelText(/add a note/i)).toHaveValue('keep going');
  });
  it('saving an emptied note sends teacher_notes: null', async () => {
    const noted = { ...selected, cell: { ...selected.cell, teacher_notes: 'keep going' } };
    render(<GradebookDrillIn selected={noted} onClose={() => {}} onWrite={() => {}} />);
    fireEvent.change(screen.getByLabelText(/add a note/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((fetch as unknown as { mock: { calls: Array<[unknown, { body: string }]> } }).mock.calls[0][1].body);
    expect(body.teacher_notes).toBeNull(); // '' → null so a teacher can CLEAR a note
  });

  // B-C7 — the submitted date appears in the header.
  it('shows the submitted date (no banned words)', () => {
    render(<GradebookDrillIn selected={selected} onClose={() => {}} onWrite={() => {}} />);
    expect(screen.getByTestId('submitted-date')).toBeInTheDocument();
    expect(hasBannedWord(screen.getByTestId('submitted-date').textContent || '')).toBe(false);
  });

  // B-C2 — a failed reteach toggle reverts the checkbox to its prior state + shows an error.
  it('reverts the reteach toggle on a failed POST and shows an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) }));
    render(<GradebookDrillIn selected={selected} onClose={() => {}} onWrite={() => {}} />);
    const toggle = screen.getByRole('checkbox', { name: /another try/i }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(toggle.checked).toBe(false); // reverted to prior state
  });
});
