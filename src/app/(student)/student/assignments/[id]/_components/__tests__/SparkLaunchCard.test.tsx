// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before the component is imported
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock window.open
const mockWindowOpen = vi.fn();
vi.stubGlobal('open', mockWindowOpen);

import { SparkLaunchCard } from '../SparkLaunchCard';

describe('SparkLaunchCard', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockWindowOpen.mockReset();
  });

  it('renders "Launch Challenge" button when not completed', () => {
    render(<SparkLaunchCard assignmentId="a1" sparkStatus="created" />);
    expect(screen.getByRole('button', { name: /launch challenge/i })).toBeTruthy();
  });

  it('on click POSTs to /api/attempts/spark-launch with assignment_id and calls window.open with launch_url', async () => {
    const launchUrl = 'https://spark.test/api/integration/auth?token=tok&redirect=%2Fstudent%2Fexperiment%2Fsa1';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ launch_url: launchUrl }),
    });

    render(<SparkLaunchCard assignmentId="a1" sparkStatus="created" />);
    fireEvent.click(screen.getByRole('button', { name: /launch challenge/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/attempts/spark-launch');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.assignment_id).toBe('a1');

    await waitFor(() => expect(mockWindowOpen).toHaveBeenCalledWith(launchUrl, '_blank'));
  });

  it('shows soft completion text and NO button when sparkStatus is completed', () => {
    render(<SparkLaunchCard assignmentId="a1" sparkStatus="completed" />);
    expect(screen.queryByRole('button', { name: /launch challenge/i })).toBeNull();
    expect(screen.getByText(/challenge complete/i)).toBeTruthy();
  });

  it('LEAK AUDIT: container text contains no digits and no % (four-audience — no scores leak to student)', () => {
    const { container } = render(<SparkLaunchCard assignmentId="a1" sparkStatus="completed" />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain('%');
  });

  it('LEAK AUDIT: container text for in_progress status has no digits and no %', () => {
    const { container } = render(<SparkLaunchCard assignmentId="a1" sparkStatus="in_progress" />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain('%');
  });

  it('terminology uses "Challenge"/"Assignment" — never "Homework"', () => {
    const { container } = render(<SparkLaunchCard assignmentId="a1" sparkStatus="created" />);
    expect(container.textContent?.toLowerCase()).not.toContain('homework');
  });

  it('shows error message when the API response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    });

    render(<SparkLaunchCard assignmentId="a1" sparkStatus="created" />);
    fireEvent.click(screen.getByRole('button', { name: /launch challenge/i }));

    await waitFor(() => expect(screen.getByText(/unauthorized/i)).toBeTruthy());
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });
});
