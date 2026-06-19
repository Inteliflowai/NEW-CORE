// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock fetch globally before the component is imported
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import ProvisionPage from '../page';

const MOCK_SUCCESS = {
  school_id: 'school-uuid-123',
  trial_expires_at: '2026-07-19T00:00:00.000Z',
  roster_status: 'deferred_demo_cast_seeded',
  credentials_summary: {
    shared_password: 'BrightOwl#4291',
    accounts: {
      teacher: { email: 'teacher@school.edu' },
      parent: { email: 'demo-parent@trial-school-u.core.com' },
      student: { email: 'demo-alex@trial-school-u.core.com' },
    },
  },
};

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/school name/i), {
    target: { value: 'Westfield Academy' },
  });
  fireEvent.change(screen.getByLabelText(/teacher name/i), {
    target: { value: 'Jane Smith' },
  });
  fireEvent.change(screen.getByLabelText(/teacher email/i), {
    target: { value: 'teacher@school.edu' },
  });
  fireEvent.change(screen.getByLabelText(/student roster/i), {
    target: { value: 'Alex Johnson\nSofia Martinez' },
  });
}

describe('ProvisionPage — form renders required fields', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('renders the school name input', () => {
    render(<ProvisionPage />);
    expect(screen.getByLabelText(/school name/i)).toBeTruthy();
  });

  it('renders the teacher name input', () => {
    render(<ProvisionPage />);
    expect(screen.getByLabelText(/teacher name/i)).toBeTruthy();
  });

  it('renders the teacher email input', () => {
    render(<ProvisionPage />);
    expect(screen.getByLabelText(/teacher email/i)).toBeTruthy();
  });

  it('renders the student roster textarea', () => {
    render(<ProvisionPage />);
    expect(screen.getByLabelText(/student roster/i)).toBeTruthy();
  });

  it('renders the trial plan select', () => {
    render(<ProvisionPage />);
    expect(screen.getByLabelText(/trial plan/i)).toBeTruthy();
  });

  it('renders the student limit input', () => {
    render(<ProvisionPage />);
    expect(screen.getByLabelText(/student limit/i)).toBeTruthy();
  });

  it('renders the submit button', () => {
    render(<ProvisionPage />);
    expect(screen.getByRole('button', { name: /provision trial school/i })).toBeTruthy();
  });
});

describe('ProvisionPage — form submission', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('calls fetch with POST to /api/admin/provision-trial with the right JSON on valid submit', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_SUCCESS,
    });

    render(<ProvisionPage />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /provision trial school/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/provision-trial');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.school_name).toBe('Westfield Academy');
    expect(body.teacher_name).toBe('Jane Smith');
    expect(body.teacher_email).toBe('teacher@school.edu');
    expect(Array.isArray(body.student_roster)).toBe(true);
    expect((body.student_roster as string[])).toContain('Alex Johnson');
    expect((body.student_roster as string[])).toContain('Sofia Martinez');
  });

  it('renders the result summary on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_SUCCESS,
    });

    render(<ProvisionPage />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /provision trial school/i }));

    await waitFor(() =>
      expect(screen.getByText(/trial provisioned/i)).toBeTruthy()
    );

    expect(screen.getByText('school-uuid-123')).toBeTruthy();
    expect(screen.getByText('BrightOwl#4291')).toBeTruthy();
  });

  it('renders an error message on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'teacher_email is required' }),
    });

    render(<ProvisionPage />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /provision trial school/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeTruthy()
    );

    expect(screen.getByText(/teacher_email is required/i)).toBeTruthy();
  });

  it('renders a network error message when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    render(<ProvisionPage />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /provision trial school/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeTruthy()
    );

    expect(screen.getByText(/network failure/i)).toBeTruthy();
  });
});
