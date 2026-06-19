// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
const refresh = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => searchParams,
}));

const signInWithPassword = vi.fn();
const signInWithOtp = vi.fn();
const resetPasswordForEmail = vi.fn();
const single = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { signInWithPassword, signInWithOtp, resetPasswordForEmail },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}));

import LoginPage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
});

describe('LoginPage', () => {
  it('renders email + password fields and the sign-in button by default', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in to core/i })).toBeInTheDocument();
  });

  it('signs in and routes to the role home', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    single.mockResolvedValue({ data: { role: 'teacher' } });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.edu' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in to core/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/today'));
  });

  it('shows an error banner on bad credentials', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.edu' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in to core/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('toggles password visibility', () => {
    render(<LoginPage />);
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text');
  });

  it('switches to magic-link mode and calls signInWithOtp with the /auth/callback redirect', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /magic link/i }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.edu',
        options: expect.objectContaining({ emailRedirectTo: expect.stringContaining('/auth/callback') }),
      }),
    ));
  });

  it('switches to forgot mode and calls resetPasswordForEmail with next=/set-password', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /forgot/i }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledWith(
      'a@b.edu',
      expect.objectContaining({ redirectTo: expect.stringContaining('/auth/callback?next=/set-password') }),
    ));
  });

  it('shows the session-expired banner when ?expired=true', () => {
    searchParams = new URLSearchParams('expired=true');
    render(<LoginPage />);
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
  });

  it('maps ?error=reset_expired to a friendly banner', () => {
    searchParams = new URLSearchParams('error=reset_expired');
    render(<LoginPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/reset link has expired/i);
  });
});
