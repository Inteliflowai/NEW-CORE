import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

describe('supabase clients', () => {
  it('server client constructs with an auth surface', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const client = await createServerSupabaseClient();
    expect(client).toBeTruthy();
    expect(client.auth).toBeTruthy();
    expect(typeof client.auth.getUser).toBe('function');
  });
  it('admin client constructs', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
    expect(createAdminSupabaseClient()).toBeTruthy();
  });
  it('browser client constructs', async () => {
    const { createBrowserSupabaseClient } = await import('@/lib/supabase/client');
    expect(createBrowserSupabaseClient()).toBeTruthy();
  });
});
