// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SyncNowButton from '../SyncNowButton';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

describe('SyncNowButton', () => {
  it('POSTs sync and reports the result counts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ classId: 'cl1', created: 0, linked: 3, skippedNoEmail: 0, skippedOther: 0, enrolled: 0, reactivated: 1, softRemoved: 2 }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(<SyncNowButton classId="cl1" />);
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));
    await waitFor(() => expect(screen.getByText(/2.*no longer in this class/i)).toBeInTheDocument());
    const call0 = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    const init = call0[1];
    expect((init as RequestInit).method).toBe('POST');
    expect(String((init as RequestInit).body)).toContain('cl1');
  });
});
