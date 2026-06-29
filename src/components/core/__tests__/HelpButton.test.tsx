// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HelpButton } from '../HelpButton';

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
const origFetch = globalThis.fetch;

beforeEach(() => {
  mockFetch.mockReset();
  // Default: both support routes return ok
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function openModal() {
  fireEvent.click(screen.getByRole('button', { name: /get help or report an issue/i }));
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^subject$/i), {
    target: { value: 'Something is broken' },
  });
  fireEvent.change(screen.getByLabelText(/^description$/i), {
    target: { value: 'Steps to reproduce the issue.' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('HelpButton + HelpTicketModal — 8 required test cases', () => {

  // 1. Renders the "?" button with correct aria-label
  it('renders the ? button with correct aria-label', () => {
    render(<HelpButton />);
    const btn = screen.getByRole('button', { name: /get help or report an issue/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('?');
  });

  // 2. Click opens modal (asserts role="dialog" appears in DOM)
  it('click opens modal — role="dialog" appears in DOM', () => {
    render(<HelpButton />);
    expect(screen.queryByRole('dialog')).toBeNull();
    openModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // 3. Pressing Escape closes the modal
  it('pressing Escape closes the modal', () => {
    render(<HelpButton />);
    openModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The modal registers a keydown listener on document
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // 4. Form has all 5 fields (subject, description, category, priority, file input)
  it('form has all 5 required fields', () => {
    render(<HelpButton />);
    openModal();
    expect(screen.getByLabelText(/^subject$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^description$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^category$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^priority$/i)).toBeInTheDocument();
    // Screenshot file input is labelled
    expect(screen.getByLabelText(/attach a screenshot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/attach a screenshot/i)).toHaveAttribute('type', 'file');
  });

  // 5. Submit with valid data calls fetch POST /api/support/tickets
  it('submit with valid data calls fetch POST /api/support/tickets', async () => {
    render(<HelpButton />);
    openModal();
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const ticketCall = mockFetch.mock.calls.find(
      (call: unknown[]) => String(call[0]).includes('/api/support/tickets'),
    );
    expect(ticketCall).toBeDefined();

    const init = ticketCall![1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.subject).toBe('Something is broken');
    expect(body.description).toBe('Steps to reproduce the issue.');
  });

  // 6. Submit while category is invalid (empty) → does not call fetch (validation)
  it('submit while category is invalid (empty value) does not call fetch', () => {
    render(<HelpButton />);
    openModal();
    // Fill subject + description so those validations pass
    fillValidForm();
    // Clear the category to the blank placeholder option
    fireEvent.change(screen.getByLabelText(/^category$/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    // Validation should block the fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 7. Screenshot field triggers POST /api/support/screenshot before ticket POST
  it('screenshot field triggers POST /api/support/screenshot before ticket POST', async () => {
    mockFetch
      // First call: screenshot upload
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ path: 'uploads/screen-abc.png' }), { status: 200 }),
      )
      // Second call: ticket creation
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    render(<HelpButton />);
    openModal();
    fillValidForm();

    const file = new File(['img-bytes'], 'screen.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/attach a screenshot/i), {
      target: { files: [file] },
    });

    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const [firstUrl] = mockFetch.mock.calls[0] as [string];
    const [secondUrl, secondInit] = mockFetch.mock.calls[1] as [string, RequestInit];

    expect(firstUrl).toContain('/api/support/screenshot');
    expect(secondUrl).toContain('/api/support/tickets');

    // The ticket POST must carry the path returned by the screenshot route
    const ticketBody = JSON.parse(secondInit.body as string);
    expect(ticketBody.screenshotPath).toBe('uploads/screen-abc.png');
  });

  // 8. Success state renders confirmation message; error state renders error text
  it('success state renders confirmation; error state renders error text', async () => {
    // --- Success case ---
    const { unmount } = render(<HelpButton />);
    openModal();
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await waitFor(() =>
      expect(screen.getByText(/your message has been sent/i)).toBeInTheDocument(),
    );
    // "Close" button should appear in success state
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument();
    unmount();

    // --- Error case ---
    mockFetch.mockResolvedValueOnce(new Response('', { status: 500 }));
    render(<HelpButton />);
    openModal();
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i);
    // Modal must stay open on error
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

});
