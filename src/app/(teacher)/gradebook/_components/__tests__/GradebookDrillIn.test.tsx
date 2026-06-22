// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GradebookDrillIn } from '../GradebookDrillIn';

const selected = {
  studentName: 'Ana Diaz',
  col: { assignment_key: 'due:d1', title: 'Due Jun 10', due_at: '2026-06-10T00:00:00Z' },
  cell: { attempt_id: 'h1', status: 'graded' as const, displayed_grade: 90, is_override: true, submitted_on_time: true, allow_redo: false, score_pct: 70 },
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
});
