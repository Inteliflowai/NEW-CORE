// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GradebookDrillIn } from '../GradebookDrillIn';
import { effortLabelPhrase } from '@/lib/copy/effortLabelPhrase';
import { EFFORT_LABELS } from '@/lib/signals/computeEffortLabel';

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

  // M2 — an empty/blank grade must NOT silently POST teacher_score:null (that's a silent clear).
  it('blocks save on an empty grade input — shows an inline error, does NOT POST', async () => {
    render(<GradebookDrillIn selected={{ ...selected, cell: { ...selected.cell, is_override: false, displayed_grade: 70 } }} onClose={() => {}} onWrite={() => {}} />);
    // Grade input starts empty for a non-override cell.
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/grade from 0 to 100/i);
    expect(fetch).not.toHaveBeenCalled();
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
});
