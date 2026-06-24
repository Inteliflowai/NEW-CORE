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

  it('IMP-2: {connected:false} from import-roster → shows reconnect CTA, not "undefined" counts', async () => {
    route({
      '/courses': { courses: [{ id: 'c1', name: 'Math', section: '1st', enrollmentCode: 'z' }] },
      '/roster': { students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', existsInCore: false }] },
      '/import-roster': { connected: false },
    });
    render(<ImportWizard />);
    await waitFor(() => screen.getByText('Math'));
    fireEvent.click(screen.getByRole('button', { name: /math/i }));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));
    await waitFor(() => expect(screen.getByRole('link', { name: /connect|reconnect/i })).toBeInTheDocument());
    // Must NOT render "undefined created" / "undefined linked" / etc.
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it('IMP-2: {needsReconnect:true} from import-roster → shows reconnect CTA', async () => {
    route({
      '/courses': { courses: [{ id: 'c1', name: 'Math', section: '1st', enrollmentCode: 'z' }] },
      '/roster': { students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', existsInCore: false }] },
      '/import-roster': { needsReconnect: true },
    });
    render(<ImportWizard />);
    await waitFor(() => screen.getByText('Math'));
    fireEvent.click(screen.getByRole('button', { name: /math/i }));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));
    await waitFor(() => expect(screen.getByRole('link', { name: /connect|reconnect/i })).toBeInTheDocument());
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it('IMP-2: 500 {error} envelope from import-roster → shows an error, not "undefined" counts', async () => {
    route({
      '/courses': { courses: [{ id: 'c1', name: 'Math', section: '1st', enrollmentCode: 'z' }] },
      '/roster': { students: [{ googleId: 'g1', name: 'A', email: 'a@b.edu', existsInCore: false }] },
      '/import-roster': { error: 'Internal Server Error' },
    });
    render(<ImportWizard />);
    await waitFor(() => screen.getByText('Math'));
    fireEvent.click(screen.getByRole('button', { name: /math/i }));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
    // Must still show the preview (not advance to 'done')
    expect(screen.queryByText(/^Done$/)).not.toBeInTheDocument();
  });

  it('initial render shows a loading line before the courses fetch settles', async () => {
    // Use a promise that we resolve manually so we can inspect the loading state first
    let resolveFetch!: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    globalThis.fetch = vi.fn(() => fetchPromise) as unknown as typeof fetch;
    render(<ImportWizard />);
    // Loading paragraph is present immediately (before the fetch resolves)
    const loadingEl = screen.getByText(/loading your google classroom courses/i);
    expect(loadingEl).toBeInTheDocument();
    expect(loadingEl).toHaveAttribute('role', 'status');
    // Resolve so the component is not left in a dangling state
    resolveFetch(new Response(JSON.stringify({ courses: [] }), { status: 200 }));
    await waitFor(() => expect(screen.queryByText(/loading your google classroom courses/i)).not.toBeInTheDocument());
  });

  it('courses fetch resolving a 500 {error} envelope → shows loadError block + reconnect CTA, NOT a bare heading', async () => {
    route({ '/courses': { error: 'Internal Server Error' } });
    render(<ImportWizard />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/couldn't load your google courses/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /connect google classroom/i })).toHaveAttribute('href', '/api/teacher/google/connect');
    // Must NOT render the "Choose a class" heading
    expect(screen.queryByText(/choose a class/i)).not.toBeInTheDocument();
  });

  it('courses fetch resolving {courses:[]} → shows the empty-state message', async () => {
    route({ '/courses': { courses: [] } });
    render(<ImportWizard />);
    await waitFor(() => {
      const el = screen.getByText(/no active google classroom courses found in your account/i);
      expect(el).toBeInTheDocument();
      expect(el).toHaveAttribute('role', 'status');
    });
  });

  it('pickCourse getting a {error}/no-students response → does NOT advance to preview, shows loadError', async () => {
    route({
      '/courses': { courses: [{ id: 'c1', name: 'Math', section: '1st', enrollmentCode: 'z' }] },
      '/roster': { error: 'Internal Server Error' },
    });
    render(<ImportWizard />);
    await waitFor(() => screen.getByText('Math'));
    fireEvent.click(screen.getByRole('button', { name: /math/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/couldn't load the roster/i)).toBeInTheDocument();
    // Must NOT advance to the preview step
    expect(screen.queryByText(/review/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^import/i })).not.toBeInTheDocument();
  });
});
