// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before the component is imported
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { SparkEnableButton } from '../SparkEnableButton';

describe('SparkEnableButton', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('renders "Enable SPARK" when not enabled', () => {
    render(<SparkEnableButton schoolId="school-1" enabled={false} />);
    expect(screen.getByRole('button', { name: /enable spark/i })).toBeTruthy();
  });

  it('shows "SPARK enabled" text when enabled prop is true', () => {
    render(<SparkEnableButton schoolId="school-1" enabled={true} />);
    expect(screen.getByText(/spark enabled/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('POSTs to /api/admin/spark-enable with school_id on click and shows done state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, spark_school_id: 'ss-1', steps: { spark: 'ok', link: 'ok', license: 'ok' } }),
    });

    render(<SparkEnableButton schoolId="school-abc" enabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /enable spark/i }));

    await waitFor(() => expect(screen.getByText(/spark enabled/i)).toBeTruthy());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/spark-enable');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.school_id).toBe('school-abc');
  });

  it('shows error state when the API response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Something went wrong' }),
    });

    render(<SparkEnableButton schoolId="school-fail" enabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /enable spark/i }));

    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeTruthy());
    // button should still be visible after error
    expect(screen.getByRole('button', { name: /enable spark/i })).toBeTruthy();
  });

  it('shows error state when the API returns ok:false in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, steps: { spark: 'failed: timeout', link: 'ok', license: 'ok' } }),
    });

    render(<SparkEnableButton schoolId="school-fail2" enabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /enable spark/i }));

    await waitFor(() => expect(screen.getByText(/spark.*timeout/i)).toBeTruthy());
  });

  it('shows error state when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    render(<SparkEnableButton schoolId="school-net" enabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /enable spark/i }));

    await waitFor(() => expect(screen.getByText(/network failure/i)).toBeTruthy());
  });
});
