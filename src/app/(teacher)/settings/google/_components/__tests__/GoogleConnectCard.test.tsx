// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GoogleConnectCard from '../GoogleConnectCard';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

function mockScope(body: object, status = 200) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('GoogleConnectCard', () => {
  it('shows a Connect action when not connected', async () => {
    mockScope({ connected: false, needsReconnect: false, missing: [] });
    render(<GoogleConnectCard />);
    await waitFor(() => expect(screen.getByRole('link', { name: /connect google classroom/i })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /connect google classroom/i })).toHaveAttribute('href', '/api/teacher/google/connect');
  });
  it('shows a Disconnect button when connected', async () => {
    mockScope({ connected: true, needsReconnect: false, missing: [] });
    render(<GoogleConnectCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument());
  });
  it('shows a Reconnect action when reconnect is needed', async () => {
    mockScope({ connected: true, needsReconnect: true, missing: ['x'] });
    render(<GoogleConnectCard />);
    await waitFor(() => expect(screen.getByRole('link', { name: /reconnect/i })).toBeInTheDocument());
  });
  it('shows neutral loading state (not disconnected) when scope-check returns non-ok', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    render(<GoogleConnectCard />);
    // Should stay in the null/loading state — never flip to "not connected"
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/checking/i));
  });
  it('shows an error banner for error=denied prop', async () => {
    mockScope({ connected: false, needsReconnect: false, missing: [] });
    render(<GoogleConnectCard initialError="denied" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/cancelled/i));
  });
  it('shows an error banner for error=unverified prop', async () => {
    mockScope({ connected: false, needsReconnect: false, missing: [] });
    render(<GoogleConnectCard initialError="unverified" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/verified/i));
  });
  it('shows a generic error banner for error=exchange prop', async () => {
    mockScope({ connected: false, needsReconnect: false, missing: [] });
    render(<GoogleConnectCard initialError="exchange" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/try again/i));
  });
  it('shows a disconnect-failure error and stays connected when disconnect returns non-ok', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('scope-check')) return new Response(JSON.stringify({ connected: true, needsReconnect: false, missing: [] }), { status: 200 });
      callCount++;
      return new Response('', { status: 500 });
    }) as unknown as typeof fetch;
    render(<GoogleConnectCard />);
    const btn = await waitFor(() => screen.getByRole('button', { name: /disconnect/i }));
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/didn't disconnect/i));
    // Still shows Disconnect button (stayed connected)
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });
});
