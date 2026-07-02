// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/students/x',
}));

import AddNoteModal from '../_components/AddNoteModal';

const fetchMock = vi.fn();
global.fetch = fetchMock;

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

describe('AddNoteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      React.createElement(AddNoteModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: false,
        onClose: vi.fn(),
      }),
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders a dialog with aria-modal when open', () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
    const { container } = render(
      React.createElement(AddNoteModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(container.innerHTML).toContain('Add a note about Alex');
  });

  it('does NOT fetch when closed', () => {
    render(
      React.createElement(AddNoteModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: false,
        onClose: vi.fn(),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GETs the notes list on open and lists prior notes', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        notes: [{ id: 'n1', note_text: 'Loves reading', created_at: '2026-06-01T00:00:00Z' }],
      }),
    );
    const { container } = render(
      React.createElement(AddNoteModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/teacher/students/notes?studentId=s1');
    await waitFor(() => expect(container.innerHTML).toContain('Your earlier notes'));
    expect(container.innerHTML).toContain('Loves reading');
  });

  it('shows no "Your earlier notes" section when the list is empty', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
    const { container } = render(
      React.createElement(AddNoteModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).not.toContain('Your earlier notes');
  });

  it('disables Save when empty or over 2000 characters; enables within range', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
    const { container } = render(
      React.createElement(AddNoteModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const saveBtn = container.querySelector('[data-testid="note-save"]')!;
    const textarea = container.querySelector('textarea')!;

    // empty -> disabled
    expect(saveBtn.getAttribute('disabled')).not.toBeNull();

    // over 2000 chars -> disabled
    fireEvent.change(textarea, { target: { value: 'x'.repeat(2001) } });
    expect(saveBtn.getAttribute('disabled')).not.toBeNull();

    // within range -> enabled
    fireEvent.change(textarea, { target: { value: 'A short note' } });
    expect(saveBtn.getAttribute('disabled')).toBeNull();
  });

  it('shows the busy label "Saving…" while the POST is in flight', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
    let resolvePost!: (v: unknown) => void;
    const { container } = render(
      React.createElement(AddNoteModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePost = resolve; }),
    );
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'A short note' } });
    fireEvent.click(container.querySelector('[data-testid="note-save"]')!);
    await waitFor(() => expect(container.innerHTML).toContain('Saving…'));
    resolvePost(jsonResponse({ ok: true, id: 'note1' }));
    await waitFor(() => expect(container.innerHTML).not.toContain('Saving…'));
  });

  it('on successful save shows the "Saved." confirmation, refreshes the list, and clears the textarea', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] })); // initial GET
    const { container } = render(
      React.createElement(AddNoteModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, id: 'note1' })); // POST
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ notes: [{ id: 'note1', note_text: 'A short note', created_at: '2026-07-01T00:00:00Z' }] }),
    ); // refreshed GET

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'A short note' } });
    fireEvent.click(container.querySelector('[data-testid="note-save"]')!);

    await waitFor(() => expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved.'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(container.innerHTML).toContain('Your earlier notes');
    expect(container.innerHTML).toContain('A short note');
    expect(textarea.value).toBe('');
  });

  it('on a failed save shows the friendly error and keeps the draft text', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] })); // initial GET
    const { container } = render(
      React.createElement(AddNoteModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, false)); // POST fails

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Keep me' } });
    fireEvent.click(container.querySelector('[data-testid="note-save"]')!);

    await waitFor(() =>
      expect(container.innerHTML).toContain("Something went wrong — your note wasn’t saved. Try again."),
    );
    expect(textarea.value).toBe('Keep me');
  });

  it('shows the privacy copy', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ notes: [] }));
    const { container } = render(
      React.createElement(AddNoteModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).toContain('Only you can see these notes.');
  });
});
