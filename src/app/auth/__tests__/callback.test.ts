/**
 * Auth callback route tests — security and redirect validation
 *
 * Verifies:
 * - Valid relative paths (next=/dashboard) are honored
 * - Open redirect attempts (//evil.com, https://evil.com) fall back to /
 * - Session exchange logic is exercised
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '../callback/route';

// Mock the Supabase client module
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';

describe('auth/callback/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper to build a mock request with searchParams
   */
  function makeRequest(baseUrl: string, code?: string, next?: string): Request {
    const url = new URL(baseUrl);
    if (code) url.searchParams.set('code', code);
    if (next) url.searchParams.set('next', next);
    return new Request(url);
  }

  /**
   * Helper to set up Supabase mock
   */
  function mockSupabaseSuccess() {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    } as never);
  }

  function mockSupabaseError() {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: new Error('exchange failed') }),
      },
    } as never);
  }

  it('should redirect to /dashboard when next=/dashboard and code exchange succeeds', async () => {
    mockSupabaseSuccess();
    const request = makeRequest('https://localhost:3000/auth/callback', 'test-code', '/dashboard');

    const response = await GET(request);

    expect(response.status).toBe(307); // redirect status
    expect(response.headers.get('location')).toBe('https://localhost:3000/dashboard');
  });

  it('should redirect to / when next is not provided and code exchange succeeds', async () => {
    mockSupabaseSuccess();
    const request = makeRequest('https://localhost:3000/auth/callback', 'test-code');

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://localhost:3000/');
  });

  it('should redirect to / (not off-origin) when next=//evil.com', async () => {
    mockSupabaseSuccess();
    const request = makeRequest('https://localhost:3000/auth/callback', 'test-code', '//evil.com');

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://localhost:3000/');
    // Verify it does NOT redirect to evil.com
    expect(response.headers.get('location')).not.toContain('evil.com');
  });

  it('should redirect to / (not off-origin) when next=https://evil.com', async () => {
    mockSupabaseSuccess();
    const request = makeRequest('https://localhost:3000/auth/callback', 'test-code', 'https://evil.com');

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://localhost:3000/');
    // Verify it does NOT redirect to evil.com
    expect(response.headers.get('location')).not.toContain('evil.com');
  });

  it('should redirect to /auth/auth-code-error when code is missing', async () => {
    mockSupabaseSuccess();
    const request = makeRequest('https://localhost:3000/auth/callback');

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://localhost:3000/auth/auth-code-error');
  });

  it('should redirect to /auth/auth-code-error when code exchange fails', async () => {
    mockSupabaseError();
    const request = makeRequest('https://localhost:3000/auth/callback', 'bad-code', '/dashboard');

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://localhost:3000/auth/auth-code-error');
  });

  it('should sanitize next path with backslashes', async () => {
    mockSupabaseSuccess();
    const request = makeRequest('https://localhost:3000/auth/callback', 'test-code', '/valid\\..\\..\\passwd');

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://localhost:3000/');
  });

  it('should allow valid nested relative paths like /dashboard/settings', async () => {
    mockSupabaseSuccess();
    const request = makeRequest('https://localhost:3000/auth/callback', 'test-code', '/dashboard/settings');

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://localhost:3000/dashboard/settings');
  });
});
