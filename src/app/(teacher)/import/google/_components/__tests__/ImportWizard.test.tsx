// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportWizard from '../ImportWizard';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

function route(map: Record<string, object>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(map).find((k) => url.includes(k))!;
    return new Response(JSON.stringify(map[key]), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('ImportWizard', () => {
  it('shows a Reconnect CTA when not connected', async () => {
    route({ '/courses': { connected: false } });
    render(<ImportWizard />);
    await waitFor(() => expect(screen.getByRole('link', { name: /connect|reconnect/i })).toHaveAttribute('href', '/api/teacher/google/connect'));
  });
  it('lists courses and advances to a REVIEW-ONLY preview (no per-student checkboxes)', async () => {
    route({
      '/courses': { courses: [{ id: 'c1', name: 'Math', section: '1st', enrollmentCode: 'z' }] },
      '/roster': { students: [
        { googleId: 'g1', name: 'A', email: 'a@b.edu', existsInCore: true },
        { googleId: 'g2', name: 'B', email: 'b@b.edu', existsInCore: false },
        { googleId: 'g3', name: 'C', email: '', existsInCore: false },
      ] },
    });
    render(<ImportWizard />);
    await waitFor(() => screen.getByText('Math'));
    fireEvent.click(screen.getByRole('button', { name: /math/i }));
    await waitFor(() => expect(screen.getByText(/review/i)).toBeInTheDocument());
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);        // review-only — no pick-list
    expect(screen.getByText(/1.*already in core/i)).toBeInTheDocument();
    expect(screen.getByText(/1.*new/i)).toBeInTheDocument();
    expect(screen.getByText(/1.*no email/i)).toBeInTheDocument();
  });
  it('imports and shows the done tiles', async () => {
    route({
      '/courses': { courses: [{ id: 'c1', name: 'Math', section: '1st', enrollmentCode: 'z' }] },
      '/roster': { students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', existsInCore: false }] },
      '/import-roster': { classId: 'cl1', created: 1, linked: 0, skippedNoEmail: 0, skippedOther: 0, enrolled: 1, reactivated: 0, softRemoved: 0, errors: 0, removeSkippedSuspectEmpty: false },
    });
    render(<ImportWizard />);
    await waitFor(() => screen.getByText('Math'));
    fireEvent.click(screen.getByRole('button', { name: /math/i }));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));
    await waitFor(() => expect(screen.getByText(/created/i)).toBeInTheDocument());
    expect(screen.getByText(/1/)).toBeInTheDocument();
  });
});
