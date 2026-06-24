// @vitest-environment jsdom
import '@/test/setup-dom';
/**
 * Component test for the "Reinforce Assignment" button inside GradebookDrillIn.
 * Renders the drill-in with a graded cell (which shows the Reinforce button),
 * clicks it, and verifies the done-state message appears after a mocked 202 response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GradebookDrillIn } from '../GradebookDrillIn';

const graded = {
  studentName: 'Ana Diaz',
  studentId: 's1',
  classId: 'c1',
  col: {
    assignment_key: 'due:d1',
    title: 'Due Jun 10',
    due_at: '2026-06-10T00:00:00Z',
    assigned_at: '2026-06-08T00:00:00Z',
  },
  cell: {
    attempt_id: 'h1',
    status: 'graded' as const,
    displayed_grade: 90,
    effort_label: null,
    teacher_notes: null,
    submitted_at: '2026-06-09T00:00:00Z',
    is_override: false,
    submitted_on_time: true,
    allow_redo: false,
    score_pct: 90,
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  // Default fetch stub: override route returns ok, trend/attempt return null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST' && String(url).includes('/reinforce')) {
        return new Response(JSON.stringify({ ok: true, status: 'creating' }), { status: 202 });
      }
      // grade override
      if (opts?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, displayed_grade: 90 }), { status: 200 });
      }
      // trend / attempt reads
      return new Response('null', { status: 200 });
    }),
  );
});

describe('GradebookDrillIn — Reinforce Assignment button', () => {
  it('renders the "Reinforce Assignment" button for a graded cell', () => {
    render(
      <GradebookDrillIn selected={graded} onClose={() => {}} onWrite={() => {}} />,
    );
    expect(
      screen.getByRole('button', { name: /reinforce assignment/i }),
    ).toBeInTheDocument();
  });

  it('clicking "Reinforce Assignment" POSTs to /api/teacher/assignments/reinforce with attempt_id', async () => {
    render(
      <GradebookDrillIn selected={graded} onClose={() => {}} onWrite={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reinforce assignment/i }));

    await waitFor(() => {
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, RequestInit | undefined]
      >;
      const reinforceCall = calls.find(
        ([url, opts]) =>
          typeof url === 'string' &&
          url.includes('/reinforce') &&
          opts?.method === 'POST',
      );
      expect(reinforceCall).toBeDefined();
      const body = JSON.parse(reinforceCall![1]!.body as string);
      expect(body.attempt_id).toBe('h1');
    });
  });

  it('shows the done message after a 202 response', async () => {
    render(
      <GradebookDrillIn selected={graded} onClose={() => {}} onWrite={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reinforce assignment/i }));

    // Done state: "on its way" message should appear
    await waitFor(() => {
      expect(
        screen.getByText(/on its way/i),
      ).toBeInTheDocument();
    });
  });

  it('disables the button while the request is in flight', async () => {
    // Delay the response so we can observe the loading state
    let resolve!: (v: Response) => void;
    const deferred = new Promise<Response>((r) => { resolve = r; });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        if (opts?.method === 'POST' && String(url).includes('/reinforce')) {
          return deferred;
        }
        return new Response('null', { status: 200 });
      }),
    );

    render(
      <GradebookDrillIn selected={graded} onClose={() => {}} onWrite={() => {}} />,
    );

    const btn = screen.getByRole('button', { name: /reinforce assignment/i });
    fireEvent.click(btn);

    // Button should be disabled while in-flight
    await waitFor(() => expect(btn).toBeDisabled());

    // Resolve the request so it cleans up
    resolve(new Response(JSON.stringify({ ok: true, status: 'creating' }), { status: 202 }));
  });

  it('shows an error state on a non-202 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, opts?: RequestInit) => {
        if (opts?.method === 'POST' && String(url).includes('/reinforce')) {
          return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
        }
        return new Response('null', { status: 200 });
      }),
    );

    render(
      <GradebookDrillIn selected={graded} onClose={() => {}} onWrite={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reinforce assignment/i }));

    await waitFor(() => {
      // An error message should appear (role=status or role=alert)
      expect(
        screen.queryByText(/couldn.t start/i) ??
        screen.queryByText(/try again/i),
      ).toBeInTheDocument();
    });
  });

  it('does NOT render the Reinforce button for a submitted (ungraded) cell', () => {
    const submittedSel = {
      ...graded,
      cell: {
        ...graded.cell,
        status: 'submitted' as const,
        attempt_id: 'h2',
        displayed_grade: null,
        score_pct: null,
        is_override: false,
      },
    };
    render(
      <GradebookDrillIn selected={submittedSel} onClose={() => {}} onWrite={() => {}} />,
    );
    expect(
      screen.queryByRole('button', { name: /reinforce assignment/i }),
    ).toBeNull();
  });

  it('does NOT render the Reinforce button when there is no attempt', () => {
    const noAttemptSel = {
      ...graded,
      cell: {
        ...graded.cell,
        status: 'missing' as const,
        attempt_id: null,
        displayed_grade: null,
        score_pct: null,
        is_override: false,
      },
    };
    render(
      <GradebookDrillIn selected={noAttemptSel} onClose={() => {}} onWrite={() => {}} />,
    );
    expect(
      screen.queryByRole('button', { name: /reinforce assignment/i }),
    ).toBeNull();
  });
});
