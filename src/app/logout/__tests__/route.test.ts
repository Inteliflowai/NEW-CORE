import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { POST } from '../route';

beforeEach(() => vi.clearAllMocks());

function mockSignOut() {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  vi.mocked(createServerSupabaseClient).mockResolvedValue({ auth: { signOut } } as never);
  return signOut;
}

describe('logout route', () => {
  it('POST signs out and redirects to /login (303 → GET)', async () => {
    const signOut = mockSignOut();
    const res = await POST(new Request('https://app.test/logout', { method: 'POST' }));
    expect(signOut).toHaveBeenCalled();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://app.test/login');
  });
});
