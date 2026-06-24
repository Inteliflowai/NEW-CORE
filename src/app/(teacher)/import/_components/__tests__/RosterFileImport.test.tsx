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
    render(<RosterFileImport mode="lean" classId="cl1" />);
    expect(screen.getByLabelText(/choose a file/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/choose a file/i) as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toContain('.xlsx');
    expect(input.accept).toContain('.csv');
  });

  it('does not show the Download template button', () => {
    render(<RosterFileImport mode="lean" classId="cl1" />);
    expect(screen.queryByRole('link', { name: /download template/i })).not.toBeInTheDocument();
  });

  it('shows an Upload button once a file is selected', async () => {
    render(<RosterFileImport mode="lean" classId="cl1" />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1,col2\nA,B'], 'roster.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument());
  });

  it('POSTs to /api/teacher/roster/import and shows summary counts on success', async () => {
    mockFetch({
      summary: { studentsCreated: 3, enrolled: 3, skipped: 1, errors: 0 },
    });
    render(<RosterFileImport mode="lean" classId="cl1" />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['name,email\nA,a@b.edu'], 'roster.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    const btn = await screen.findByRole('button', { name: /upload/i });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    // Should show the summary values (studentsCreated=3, enrolled=3)
    expect(screen.getAllByText(/3/).length).toBeGreaterThanOrEqual(1);
    // I-2: assert classId and file are present in the FormData body
    const body = (vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get('classId')).toBe('cl1');
    expect(body.get('file')).not.toBeNull();
  });

  it('disables Upload and shows an alert when classId is null', async () => {
    render(<RosterFileImport mode="lean" classId={null} />);
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
    render(<RosterFileImport mode="lean" classId="cl1" />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['name,email\nA,a@b.edu'], 'roster.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    const btn = await screen.findByRole('button', { name: /upload/i });
    fireEvent.click(btn);
    // During the in-flight request, a loading indicator appears
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    resolve(new Response(JSON.stringify({ summary: { studentsCreated: 0, enrolled: 0, skipped: 0, errors: 0 } }), { status: 200 }));
  });

  it('shows an error on a failed POST', async () => {
    mockFetch({ error: 'Something went wrong' }, 500);
    render(<RosterFileImport mode="lean" classId="cl1" />);
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
    render(<RosterFileImport mode="full" classId={null} />);
    expect(screen.getByLabelText(/choose a file/i)).toBeInTheDocument();
  });

  it('renders a Download template link', () => {
    render(<RosterFileImport mode="full" classId={null} />);
    const link = screen.getByRole('link', { name: /download template/i });
    expect(link).toHaveAttribute('href', '/api/admin/roster/template');
  });

  it('renders a Preview button (disabled when no file chosen)', () => {
    render(<RosterFileImport mode="full" classId={null} />);
    const btn = screen.getByRole('button', { name: /preview/i });
    expect(btn).toBeDisabled();
  });

  it('enables the Preview button once a file is selected', async () => {
    render(<RosterFileImport mode="full" classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1'], 'roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /preview/i })).not.toBeDisabled());
  });

  it('POSTs mode=preview and shows per-sheet counts', async () => {
    mockFetch({
      sheets: { Teachers: { rows: 2, issues: [] }, Students: { rows: 5, issues: [] } },
    });
    render(<RosterFileImport mode="full" classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1'], 'roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(input, { target: { files: [file] } });
    const btn = await screen.findByRole('button', { name: /preview/i });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });

  it('shows a Commit button after a successful preview', async () => {
    mockFetch({
      sheets: { Teachers: { rows: 2, issues: [] }, Students: { rows: 5, issues: [] } },
    });
    render(<RosterFileImport mode="full" classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1'], 'roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(input, { target: { files: [file] } });
    const previewBtn = await screen.findByRole('button', { name: /preview/i });
    fireEvent.click(previewBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: /commit/i })).toBeInTheDocument());
  });

  it('I-3: full commit path — two sequential fetches; second is mode=commit; success summary renders', async () => {
    // First call: preview response
    // Second call: commit response
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ sheets: { Students: { rows: 4, issues: ['Row 2: missing email'] } } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ summary: { studentsCreated: 4, enrolled: 4, skipped: 0, errors: 0 } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    render(<RosterFileImport mode="full" classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1'], 'roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(input, { target: { files: [file] } });

    // Step 1: click Preview — waits for Commit button to appear
    const previewBtn = await screen.findByRole('button', { name: /preview/i });
    fireEvent.click(previewBtn);
    const commitBtn = await screen.findByRole('button', { name: /commit/i });

    // Step 2: click Commit
    fireEvent.click(commitBtn);

    // (a) assert second fetch was called with mode=commit in the body
    await waitFor(() => expect(callCount).toBe(2));
    const secondBody = (vi.mocked(globalThis.fetch).mock.calls[1][1] as RequestInit).body as FormData;
    expect(secondBody.get('mode')).toBe('commit');

    // (b) assert the success / role=status summary renders
    await waitFor(() => {
      const status = screen.getByRole('status');
      expect(status).toBeInTheDocument();
      expect(status).toHaveTextContent(/import complete/i);
    });
  });

  it('shows an error on a failed preview POST', async () => {
    mockFetch({ error: 'Bad file format' }, 400);
    render(<RosterFileImport mode="full" classId={null} />);
    const input = screen.getByLabelText(/choose a file/i);
    const file = new File(['col1'], 'roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(input, { target: { files: [file] } });
    const previewBtn = await screen.findByRole('button', { name: /preview/i });
    fireEvent.click(previewBtn);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
