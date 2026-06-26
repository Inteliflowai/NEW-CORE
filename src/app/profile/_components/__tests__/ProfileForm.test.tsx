// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock next/navigation (ProfileForm has a back link)
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Mock createBrowserSupabaseClient
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: vi.fn(() => ({
    auth: {
      updateUser: vi.fn(async () => ({ error: null })),
    },
  })),
}));

// Keep a stable fetch mock
const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
});

beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, full_name: 'Dana' }), { status: 200 }),
  ) as unknown as typeof fetch;
});

import { ProfileForm } from '../ProfileForm';

describe('ProfileForm', () => {
  it('renders name input pre-filled with initialName', () => {
    render(<ProfileForm initialName="Dana" email="d@x.edu" avatarUrl={null} />);
    const nameInput = screen.getByRole('textbox', { name: /display name/i });
    expect(nameInput).toHaveValue('Dana');
  });

  it('shows the email read-only', () => {
    render(<ProfileForm initialName="Dana" email="d@x.edu" avatarUrl={null} />);
    expect(screen.getByText('d@x.edu')).toBeInTheDocument();
  });

  it('renders a Save name button', () => {
    render(<ProfileForm initialName="Dana" email="d@x.edu" avatarUrl={null} />);
    expect(screen.getByRole('button', { name: /save name/i })).toBeInTheDocument();
  });

  it('renders avatar file input', () => {
    render(<ProfileForm initialName="Dana" email="d@x.edu" avatarUrl={null} />);
    const fileInput = screen.getByLabelText(/upload photo/i);
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('type', 'file');
  });

  it('renders password and confirm fields plus Change password button', () => {
    render(<ProfileForm initialName="Dana" email="d@x.edu" avatarUrl={null} />);
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
  });

  it('renders a back link to /today', () => {
    render(<ProfileForm initialName="Dana" email="d@x.edu" avatarUrl={null} />);
    const back = screen.getByRole('link', { name: /back/i });
    expect(back).toHaveAttribute('href', '/today');
  });
});
