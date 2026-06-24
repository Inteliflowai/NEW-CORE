// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RosterFileImport from '../RosterFileImport';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

function mockFetch(response: object, status = 200) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(response), { status })
  ) as unknown as typeof fetch;
}

describe('RosterFileImport — lean mode', () => {
  it('renders a labeled file input', () => {
    render(<RosterFileImport canLean classId="cl1" />);
    expect(screen.getByLabelText(/choose a file/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/choose a file/i) as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toContain('.xlsx');
    expect(input.accept).toContain('.csv');
  });

  it('does not show the Download template button in lean-only mode', () => {
    render(<RosterFileImport canLean classId="cl1" />);
    expect(screen.queryByRole('link', { name: /download template/i })).not.toBeInTheDocument();
  });

  it('shows an Upload button once a file is selected', async () => {
    render(<RosterFileImport canLean classId="cl1" />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1,col2\nA,B'], 'roster.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument());
  });

  it('POSTs to /api/teacher/roster/import and shows summary counts (studentsCreated/enrolled) on success', async () => {
    mockFetch({
      summary: { studentsCreated: 3, studentsExisting: 1, enrolled: 3, alreadyEnrolled: 0, errors: 0 },
    });
    render(<RosterFileImport canLean classId="cl1" />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['name,email\nA,a@b.edu'], 'roster.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    const btn = await screen.findByRole('button', { name: /upload/i });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    // Should show the summary values (studentsCreated=3, enrolled=3)
    expect(screen.getAllByText(/3/).length).toBeGreaterThanOrEqual(1);
    // Assert classId and file are present in the FormData body
    const body = (vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get('classId')).toBe('cl1');
    expect(body.get('file')).not.toBeNull();
  });

  it('renders studentsExisting and alreadyEnrolled counts when present', async () => {
    mockFetch({
      summary: { studentsCreated: 2, studentsExisting: 3, enrolled: 2, alreadyEnrolled: 4, errors: 0 },
    });
    render(<RosterFileImport canLean classId="cl1" />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['name,email\nA,a@b.edu'], 'roster.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    const btn = await screen.findByRole('button', { name: /upload/i });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByText(/already in core/i)).toBeInTheDocument();
    expect(screen.getByText(/already enrolled/i)).toBeInTheDocument();
  });

  it('does NOT render a "skipped" row (key does not exist in LeanSummary)', async () => {
    mockFetch({
      summary: { studentsCreated: 1, enrolled: 1, errors: 0 },
    });
    render(<RosterFileImport canLean classId="cl1" />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['name,email\nA,a@b.edu'], 'roster.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.queryByText(/skipped/i)).not.toBeInTheDocument();
  });

  it('disables Upload and shows an alert when classId is null', async () => {
    render(<RosterFileImport canLean classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['name,email\nA,a@b.edu'], 'roster.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /upload/i })).toBeDisabled());
    expect(screen.getByRole('alert')).toHaveTextContent(/no class selected/i);
  });

  it('shows a loading state while the POST is in flight', async () => {
    let resolve!: (r: Response) => void;
    const pending = new Promise<Response>((res) => { resolve = res; });
    globalThis.fetch = vi.fn(() => pending) as unknown as typeof fetch;
    render(<RosterFileImport canLean classId="cl1" />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['name,email\nA,a@b.edu'], 'roster.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    const btn = await screen.findByRole('button', { name: /upload/i });
    fireEvent.click(btn);
    // During the in-flight request, a loading indicator appears
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    resolve(new Response(JSON.stringify({ summary: { studentsCreated: 0, enrolled: 0, errors: 0 } }), { status: 200 }));
  });

  it('shows an error on a failed POST', async () => {
    mockFetch({ error: 'Something went wrong' }, 500);
    render(<RosterFileImport canLean classId="cl1" />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['name,email\nA,a@b.edu'], 'roster.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    const btn = await screen.findByRole('button', { name: /upload/i });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});

describe('RosterFileImport — full mode', () => {
  it('renders a labeled file input', () => {
    render(<RosterFileImport canFull classId={null} />);
    expect(screen.getByLabelText(/choose a file/i)).toBeInTheDocument();
  });

  it('renders a Download template link', () => {
    render(<RosterFileImport canFull classId={null} />);
    const link = screen.getByRole('link', { name: /download template/i });
    expect(link).toHaveAttribute('href', '/api/admin/roster/template');
  });

  it('renders a Preview button (disabled when no file chosen)', () => {
    render(<RosterFileImport canFull classId={null} />);
    const btn = screen.getByRole('button', { name: /preview/i });
    expect(btn).toBeDisabled();
  });

  it('enables the Preview button once a file is selected', async () => {
    render(<RosterFileImport canFull classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1'], 'roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /preview/i })).not.toBeDisabled());
  });

  it('POSTs mode=preview and shows per-entity counts from data.counts', async () => {
    mockFetch({
      mode: 'preview',
      counts: { teachers: 2, classes: 3, students: 5, enrollments: 5, parents: 0 },
      issues: [],
    });
    render(<RosterFileImport canFull classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1'], 'roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(input, { target: { files: [file] } });
    const btn = await screen.findByRole('button', { name: /preview/i });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    // Counts from data.counts must appear
    expect(screen.getByText(/teachers:\s*2/i)).toBeInTheDocument();
    expect(screen.getByText(/students:\s*5/i)).toBeInTheDocument();
  });

  it('shows a Commit button after a successful preview', async () => {
    mockFetch({
      mode: 'preview',
      counts: { teachers: 2, classes: 3, students: 5, enrollments: 5, parents: 0 },
      issues: [],
    });
    render(<RosterFileImport canFull classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1'], 'roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(input, { target: { files: [file] } });
    const previewBtn = await screen.findByRole('button', { name: /preview/i });
    fireEvent.click(previewBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: /commit/i })).toBeInTheDocument());
  });

  it('full commit — second fetch is mode=commit; renders nested summary with created/skipped/errors', async () => {
    // First call: preview response; Second call: commit response with NESTED summary.
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            mode: 'preview',
            counts: { teachers: 2, classes: 1, students: 4, enrollments: 4, parents: 0 },
            issues: ['Row 2: missing email'],
          }),
          { status: 200 },
        );
      }
      // Commit: nested summary object
      return new Response(
        JSON.stringify({
          mode: 'commit',
          summary: {
            teachers: { created: 2, skipped: 0, errors: 0 },
            classes: { created: 1, skipped: 0, errors: 0 },
            students: { created: 4, skipped: 0, errors: 0 },
            enrollments: { created: 4, skipped: 0, errors: 0 },
            parents: { created: 0, linked: 0, skipped: 0, errors: 0 },
            issues: [],
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    render(<RosterFileImport canFull classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1'], 'roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(input, { target: { files: [file] } });

    // Step 1: click Preview
    const previewBtn = await screen.findByRole('button', { name: /preview/i });
    fireEvent.click(previewBtn);
    const commitBtn = await screen.findByRole('button', { name: /commit/i });

    // Step 2: click Commit
    fireEvent.click(commitBtn);

    // Assert second fetch was called with mode=commit in the body
    await waitFor(() => expect(callCount).toBe(2));
    const secondBody = (vi.mocked(globalThis.fetch).mock.calls[1][1] as RequestInit).body as FormData;
    expect(secondBody.get('mode')).toBe('commit');

    // Assert the success role=status summary renders with "Import complete"
    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();
      expect(status).toHaveTextContent(/import complete/i);
    });

    // Assert nested summary entity rows render
    await waitFor(() => {
      expect(screen.getByText(/teachers/i)).toBeInTheDocument();
      expect(screen.getByText(/students/i)).toBeInTheDocument();
    });
  });

  it('shows an error on a failed preview POST', async () => {
    mockFetch({ error: 'Bad file format' }, 400);
    render(<RosterFileImport canFull classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1'], 'roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(input, { target: { files: [file] } });
    const previewBtn = await screen.findByRole('button', { name: /preview/i });
    fireEvent.click(previewBtn);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});

describe('RosterFileImport — both modes (sub-selector)', () => {
  it('shows the sub-selector when both canFull and canLean and classId present', () => {
    render(<RosterFileImport canFull canLean classId="cl1" />);
    // role=group for the sub-selector
    expect(screen.getByRole('group', { name: /import scope/i })).toBeInTheDocument();
    // Both radio buttons are present
    expect(screen.getByRole('radio', { name: /whole roster/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /just this class/i })).toBeInTheDocument();
  });

  it('defaults to full mode when canFull is true', () => {
    render(<RosterFileImport canFull canLean classId="cl1" />);
    // Full is the default so Download template is visible
    expect(screen.getByRole('link', { name: /download template/i })).toBeInTheDocument();
    // Preview button should be visible (and disabled since no file)
    expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument();
  });

  it('switching to lean mode shows the Upload button instead of Preview', async () => {
    render(<RosterFileImport canFull canLean classId="cl1" />);
    // Start in full mode
    expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument();

    // Switch to lean
    const leanRadio = screen.getByRole('radio', { name: /just this class/i });
    fireEvent.click(leanRadio);

    await waitFor(() => expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument();
  });

  it('does NOT show the sub-selector when only canLean (no canFull)', () => {
    render(<RosterFileImport canLean classId="cl1" />);
    expect(screen.queryByRole('group', { name: /import scope/i })).not.toBeInTheDocument();
  });

  it('does NOT show the sub-selector when only canFull (no canLean)', () => {
    render(<RosterFileImport canFull classId={null} />);
    expect(screen.queryByRole('group', { name: /import scope/i })).not.toBeInTheDocument();
  });
});
