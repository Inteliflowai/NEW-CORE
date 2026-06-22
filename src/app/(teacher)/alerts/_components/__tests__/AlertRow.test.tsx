// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AlertRow } from '../AlertRow';

const alert = { id: 'a1', student_id: 's1', student_name: 'Ann Lee', source_kind: 'low_quiz' as const, severity: 'urgent' as const, created_at: '2026-06-22T10:00:00Z' };

beforeEach(() => { vi.restoreAllMocks(); });

describe('AlertRow', () => {
  it('shows the student name and a leak-free trigger label', () => {
    render(<AlertRow alert={alert} classId="c1" onResolved={() => {}} />);
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
    expect(screen.getByText(/comprehension check/i)).toBeInTheDocument();
  });
  it('calls resolve then onResolved on Mark handled', async () => {
    const onResolved = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    render(<AlertRow alert={alert} classId="c1" onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('button', { name: /mark handled/i }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith('/api/teacher/alerts/resolve', expect.objectContaining({ method: 'POST' }));
  });
});
