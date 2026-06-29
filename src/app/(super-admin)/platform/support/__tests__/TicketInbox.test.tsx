// @vitest-environment jsdom
import '@/test/setup-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TicketRow } from '../_components/TicketInbox';

// Stub fetch before any component import
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { TicketInbox } from '../_components/TicketInbox';

const SAMPLE_TICKETS: TicketRow[] = [
  {
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
  },
  {
    id: 'ticket-2',
    subject: 'Feature request for dark mode',
    category: 'feature',
    priority: 'normal',
    status: 'open',
    submitted_by_role: 'teacher',
    school_id: 'school-1',
    created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    assigned_to: null,
    description: 'Please add dark mode',
    screenshot_path: null,
  },
];

describe('TicketInbox', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('renders with initialTickets showing subject and category', () => {
    render(<TicketInbox initialTickets={SAMPLE_TICKETS} adminId="admin-1" />);
    expect(screen.getByText('Login not working')).toBeTruthy();
    expect(screen.getByText('Feature request for dark mode')).toBeTruthy();
    // category badge for 'bug' should appear
    const bugBadge = screen.getByText('bug');
    expect(bugBadge).toBeTruthy();
  });

  it('priority badge renders for urgent ticket', () => {
    render(<TicketInbox initialTickets={SAMPLE_TICKETS} adminId="admin-1" />);
    expect(screen.getByText('urgent')).toBeTruthy();
  });

  it('tab click fetches with correct ?status=in_progress param', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tickets: [], page: 0, hasMore: false }),
    });
    render(<TicketInbox initialTickets={SAMPLE_TICKETS} adminId="admin-1" />);
    const inProgressTab = screen.getByRole('tab', { name: /in progress/i });
    fireEvent.click(inProgressTab);
    await waitFor(() => {
      const calls = mockFetch.mock.calls as [string, RequestInit][];
      const called = calls.some(([url]) =>
        typeof url === 'string' && url.includes('status=in_progress'),
      );
      expect(called).toBe(true);
    });
  });

  it('tab click fetches with ?status=resolved param when resolved tab clicked', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tickets: [], page: 0, hasMore: false }),
    });
    render(<TicketInbox initialTickets={SAMPLE_TICKETS} adminId="admin-1" />);
    const resolvedTab = screen.getByRole('tab', { name: /resolved/i });
    fireEvent.click(resolvedTab);
    await waitFor(() => {
      const calls = mockFetch.mock.calls as [string, RequestInit][];
      const called = calls.some(([url]) =>
        typeof url === 'string' && url.includes('status=resolved'),
      );
      expect(called).toBe(true);
    });
  });

  it('clicking a ticket row renders TicketDetail panel', async () => {
    // TicketDetail will fetch messages on mount
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });
    render(<TicketInbox initialTickets={SAMPLE_TICKETS} adminId="admin-1" />);

    // Find and click the first ticket row button
    const rowButton = screen.getByRole('button', { name: /login not working/i });
    fireEvent.click(rowButton);

    // After click, TicketDetail renders — look for the detail panel heading
    await waitFor(() => {
      // TicketDetail renders the subject in a heading within the detail panel
      const headings = screen.getAllByText(/login not working/i);
      // At least 2 occurrences: one in the list row + one in the detail panel
      expect(headings.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows empty state when no tickets match the tab', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tickets: [], page: 0, hasMore: false }),
    });
    render(<TicketInbox initialTickets={SAMPLE_TICKETS} adminId="admin-1" />);
    fireEvent.click(screen.getByRole('tab', { name: /in progress/i }));
    await waitFor(() => {
      expect(screen.getByText(/no tickets/i)).toBeTruthy();
    });
  });

  it('shows Load more button when hasMore is true and appends tickets on click', async () => {
    const extraTicket: TicketRow = {
      id: 'ticket-3',
      subject: 'Third ticket',
      category: 'general',
      priority: 'low',
      status: 'in_progress',
      submitted_by_role: 'teacher',
      school_id: 'school-1',
      created_at: new Date().toISOString(),
      assigned_to: null,
      description: 'Another issue',
      screenshot_path: null,
    };
    // First tab-change fetch returns hasMore=true
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tickets: [extraTicket], page: 0, hasMore: true }),
    });
    // Load-more fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tickets: [], page: 1, hasMore: false }),
    });

    render(<TicketInbox initialTickets={SAMPLE_TICKETS} adminId="admin-1" />);
    fireEvent.click(screen.getByRole('tab', { name: /in progress/i }));

    await waitFor(() => {
      expect(screen.getByText('Third ticket')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /load more/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => {
      const calls = mockFetch.mock.calls as [string, RequestInit][];
      const loadMoreCalled = calls.some(([url]) =>
        typeof url === 'string' && url.includes('page=1'),
      );
      expect(loadMoreCalled).toBe(true);
    });
  });
});
