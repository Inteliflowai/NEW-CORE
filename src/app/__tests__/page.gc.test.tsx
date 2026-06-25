// src/app/__tests__/page.gc.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const single = vi.fn();
const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
const resolveGcDeepLink = vi.fn();

vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/google/launchResolve', () => ({ resolveGcDeepLink: (...a: unknown[]) => resolveGcDeepLink(...a) }));

beforeEach(() => {
  for (const m of [getUser, single, redirect, resolveGcDeepLink]) m.mockReset();
  redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT:${url}`); });
});

async function run(search: Record<string, string>) {
  const { default: Home } = await import('@/app/page');
  return Home({ searchParams: Promise.resolve(search) } as never);
}

describe('Home /?gc= deep-link', () => {
  it('redirects an unauthenticated visitor to /login', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(run({})).rejects.toThrow('REDIRECT:/login');
  });
  it('deep-links an authenticated student to their assignment', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'stu1' } } });
    single.mockResolvedValue({ data: { role: 'student' } });
    resolveGcDeepLink.mockResolvedValue('/student/assignments/A1');
    await expect(run({ gc: 'assignment', id: 'L1' })).rejects.toThrow('REDIRECT:/student/assignments/A1');
    expect(resolveGcDeepLink).toHaveBeenCalledWith(expect.anything(), { studentId: 'stu1', gc: 'assignment', id: 'L1' });
  });
  it('a teacher with ?gc= goes to role home (no deep-link)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 't1' } } });
    single.mockResolvedValue({ data: { role: 'teacher' } });
    await expect(run({ gc: 'assignment', id: 'L1' })).rejects.toThrow('REDIRECT:/today');
    expect(resolveGcDeepLink).not.toHaveBeenCalled();
  });
  it('a student with no ?gc= goes to the student dashboard', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'stu1' } } });
    single.mockResolvedValue({ data: { role: 'student' } });
    await expect(run({})).rejects.toThrow('REDIRECT:/student/dashboard');
  });
});
