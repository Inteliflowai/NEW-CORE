// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/students/x',
}));

import QuickHighFiveModal from '../_components/QuickHighFiveModal';

const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('QuickHighFiveModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the textarea and Send button when open and classId is provided', () => {
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    expect(container.innerHTML).toContain('textarea');
    expect(container.innerHTML).toContain('Send');
    expect(container.innerHTML).toContain('Alex');
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: false,
        onClose: vi.fn(),
      }),
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows a friendly message and disables Send when classId is null', () => {
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: null,
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    // Send button exists but is disabled
    const sendBtn = container.querySelector('button[type="submit"], button[data-testid="hf-send"]');
    expect(sendBtn).toBeTruthy();
    expect(sendBtn?.getAttribute('disabled')).not.toBeNull();
    // Shows guidance
    expect(container.innerHTML).toContain('class');
  });

  it('calls POST /api/teacher/high-fives/send on submit with correct payload', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, id: 'hf1' }),
    });
    const onClose = vi.fn();
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose,
      }),
    );
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'Great work today!' } });
    const sendBtn = container.querySelector('button[data-testid="hf-send"]')!;
    fireEvent.click(sendBtn);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/teacher/high-fives/send');
    const body = JSON.parse(opts.body as string);
    expect(body.student_id).toBe('s1');
    expect(body.class_id).toBe('c1');
    expect(body.text).toBe('Great work today!');
    expect(body.ai_drafted).toBe(false);
  });

  it('shows success message after a successful send', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, id: 'hf1' }),
    });
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'Great work!' } });
    fireEvent.click(container.querySelector('button[data-testid="hf-send"]')!);
    await waitFor(() =>
      expect(container.innerHTML.toLowerCase()).toMatch(/sent|high five/i)
    );
  });

  it('shows violations error on 422 response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ violations: ['Avoid using names'] }),
    });
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'Alex you are great!' } });
    fireEvent.click(container.querySelector('button[data-testid="hf-send"]')!);
    await waitFor(() =>
      expect(container.innerHTML).toContain('Avoid using names')
    );
  });
});
