// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const getSession = vi.fn();
const updateUser = vi.fn();
const onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession, updateUser, onAuthStateChange } }),
}));

import SetPasswordPage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
});

describe('SetPasswordPage', () => {
  it('shows the form once a session is present', async () => {
    render(<SetPasswordPage />);
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());
  });

  it('rejects a password shorter than 8 chars', async () => {
    render(<SetPasswordPage />);
    await waitFor(() => screen.getByLabelText(/new password/i));
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords', async () => {
    render(<SetPasswordPage />);
    await waitFor(() => screen.getByLabelText(/new password/i));
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'different1' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('calls updateUser and redirects on success (after the brief confirmation delay)', async () => {
    vi.useFakeTimers();
    updateUser.mockResolvedValue({ error: null });
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    render(<SetPasswordPage />);
    await vi.advanceTimersByTimeAsync(0); // flush getSession → ready
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    await vi.advanceTimersByTimeAsync(0); // flush updateUser promise
    expect(updateUser).toHaveBeenCalledWith({ password: 'longenough1' });
    await vi.advanceTimersByTimeAsync(1500); // fire the redirect timeout
    expect(push).toHaveBeenCalledWith('/login');
    vi.useRealTimers();
  });

  it('shows an actionable fallback (error + back link) when no recovery session arrives', async () => {
    vi.useFakeTimers();
    getSession.mockResolvedValue({ data: { session: null } });
    render(<SetPasswordPage />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(/Verifying your reset link/i)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('unsubscribes from the auth listener on unmount', () => {
    const unsub = vi.fn();
    onAuthStateChange.mockReturnValueOnce({ data: { subscription: { unsubscribe: unsub } } });
    const { unmount } = render(<SetPasswordPage />);
    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});
