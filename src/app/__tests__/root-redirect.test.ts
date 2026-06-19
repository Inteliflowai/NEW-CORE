import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`); }),
}));
import { createServerSupabaseClient } from '@/lib/supabase/server';
import Home from '../page';

beforeEach(() => vi.clearAllMocks());

it('redirects an unauthenticated visitor to /login', async () => {
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as never);
  await expect(Home()).rejects.toThrow('REDIRECT:/login');
});

it('redirects an authenticated teacher to /today', async () => {
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'teacher' } }) }) }) }),
  } as never);
  await expect(Home()).rejects.toThrow('REDIRECT:/today');
});
