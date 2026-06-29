// @vitest-environment jsdom
import '@/test/setup-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TicketRow } from '../_components/TicketInbox';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { TicketDetail } from '../_components/TicketDetail';

const SAMPLE_TICKET: TicketRow = {
  id: 'ticket-1',
  subject: 'Login not working',
  category: 'bug',
  priority: 'urgent',
  status: 'open',
  submitted_by_role: 'teacher',
  school_id: 'school-1',
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  assigned_to: null,
  description: 'I cannot log in to my account',
  screenshot_path: null,
};

const SAMPLE_MESSAGES = [
  {
    id: 'msg-1',
    sender_id: 'user-submitter',
    message: 'First message from submitter',
    is_internal: false,
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'msg-2',
    sender_id: 'admin-1',
    message: 'Admin reply here',
    is_internal: false,
    created_at: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: 'msg-3',
    sender_id: 'admin-1',
    message: 'This is an internal note',
    is_internal: true,
    created_at: new Date(Date.now() - 900000).toISOString(),
  },
];

describe('TicketDetail', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('renders thread messages in order', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: SAMPLE_MESSAGES }),
    });

    render(<TicketDetail ticket={SAMPLE_TICKET} adminId="admin-1" />);

    await waitFor(() => {
      expect(screen.getByText('First message from submitter')).toBeTruthy();
      expect(screen.getByText('Admin reply here')).toBeTruthy();
      expect(screen.getByText('This is an internal note')).toBeTruthy();
    });

    // Check order: first message before second
    const allMessages = screen.getAllByText(/message|reply|internal note/i);
    const firstIdx = allMessages.findIndex(el => el.textContent?.includes('First message'));
    const secondIdx = allMessages.findIndex(el => el.textContent?.includes('Admin reply'));
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it('internal note is visually marked with "Internal note" text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: SAMPLE_MESSAGES }),
    });

    render(<TicketDetail ticket={SAMPLE_TICKET} adminId="admin-1" />);

    await waitFor(() => {
      // The label element in the thread (not the message text content) should exist.
      // Use getAllByText since the phrase also appears in the message content itself.
      const matches = screen.getAllByText(/internal note/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      // At least one match should be the italic label span (the visual marker)
      const labelSpan = matches.find((el) => el.tagName === 'SPAN' && el.textContent?.includes('Internal note'));
      expect(labelSpan).toBeTruthy();
    });
  });

  it('reply form submit calls POST /api/support/tickets/${id}/messages', async () => {
    // First fetch: messages GET
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });
    // Second fetch: messages POST
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
      status: 201,
    });
    // Third fetch: messages re-fetch after reply
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });

    render(<TicketDetail ticket={SAMPLE_TICKET} adminId="admin-1" />);

    // Wait for initial load
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Type a reply
    const textarea = screen.getByRole('textbox', { name: /reply/i });
    fireEvent.change(textarea, { target: { value: 'My test reply' } });

    // Submit
    const sendButton = screen.getByRole('button', { name: /send reply/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      const calls = mockFetch.mock.calls as [string, (RequestInit | undefined)][];
      const postCall = calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url.includes('/tickets/ticket-1/messages') &&
          init !== undefined &&
          (init as RequestInit).method === 'POST',
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse((postCall![1] as RequestInit).body as string) as Record<
        string,
        unknown
      >;
      expect(body.message).toBe('My test reply');
    });
  });

  it('Resolve button calls PATCH with {status: "resolved"}', async () => {
    // Messages GET
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });
    // PATCH
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const onStatusChange = vi.fn();
    render(
      <TicketDetail
        ticket={{ ...SAMPLE_TICKET, status: 'open' }}
        adminId="admin-1"
        onStatusChange={onStatusChange}
      />,
    );

    // Wait for messages load
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const resolveBtn = screen.getByRole('button', { name: /^resolve$/i });
    fireEvent.click(resolveBtn);

    await waitFor(() => {
      const calls = mockFetch.mock.calls as [string, (RequestInit | undefined)][];
      const patchCall = calls.find(
        ([url, init]) =>
          typeof url === 'string' &&
          url.includes('/tickets/ticket-1') &&
          init !== undefined &&
          (init as RequestInit).method === 'PATCH',
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string) as Record<
        string,
        unknown
      >;
      expect(body.status).toBe('resolved');
    });
  });

  it('onStatusChange callback called after successful status change', async () => {
    // Messages GET
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });
    // PATCH
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const onStatusChange = vi.fn();
    render(
      <TicketDetail
        ticket={{ ...SAMPLE_TICKET, status: 'in_progress' }}
        adminId="admin-1"
        onStatusChange={onStatusChange}
      />,
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /^resolve$/i }));

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledTimes(1);
    });
  });

  it('shows inline error when messages fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
      status: 500,
    });

    render(<TicketDetail ticket={SAMPLE_TICKET} adminId="admin-1" />);

    await waitFor(() => {
      expect(screen.getByText(/could not load messages/i)).toBeTruthy();
    });
  });

  it('renders screenshot thumbnail when screenshot_path is set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });

    const ticketWithScreenshot: TicketRow = {
      ...SAMPLE_TICKET,
      screenshot_path: 'support-uploads/user-1/abc.png',
    };

    render(<TicketDetail ticket={ticketWithScreenshot} adminId="admin-1" />);

    await waitFor(() => {
      const img = screen.getByRole('img', { name: /screenshot/i });
      expect(img).toBeTruthy();
      expect((img as HTMLImageElement).src).toContain(
        encodeURIComponent('support-uploads/user-1/abc.png'),
      );
    });
  });

  it('"Mark in progress" button appears when status is open', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });

    render(<TicketDetail ticket={{ ...SAMPLE_TICKET, status: 'open' }} adminId="admin-1" />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('button', { name: /mark in progress/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^resolve$/i })).toBeTruthy();
  });

  it('"Reopen" button appears when status is resolved', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });

    render(
      <TicketDetail ticket={{ ...SAMPLE_TICKET, status: 'resolved' }} adminId="admin-1" />,
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('button', { name: /reopen/i })).toBeTruthy();
  });

  it('internal note checkbox is present on the reply form', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });

    render(<TicketDetail ticket={SAMPLE_TICKET} adminId="admin-1" />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const checkbox = screen.getByRole('checkbox', { name: /internal/i });
    expect(checkbox).toBeTruthy();
  });
});
