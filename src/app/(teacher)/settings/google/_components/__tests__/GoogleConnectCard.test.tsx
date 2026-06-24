// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GoogleConnectCard from '../GoogleConnectCard';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

function mockScope(body: object) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
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
});
