import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireRole } from '../requireRole';

/**
 * Build an INSPECTABLE mock supabase: the users-table select/eq are spies so we
 * can assert the exact columns + filter the impl used (catches a wrong column/id).
 * Returns the spies for assertions.
 */
function mockSupabase(opts: {
  user: { id: string } | null;
  profile?: { role: string | null; school_id: string | null } | null;
  school?: { trial_status: string } | null;
}) {
  const usersSelect = vi.fn().mockReturnThis();
  const usersEq = vi.fn().mockReturnThis();
  const from = vi.fn((table: string) => {
    if (table === 'users') {
      return { select: usersSelect, eq: usersEq, single: async () => ({ data: opts.profile ?? null }) };
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: async () => ({ data: opts.school ?? null }),
    };
  });
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: opts.user } }) },
    from,
  } as never);
  return { from, usersSelect, usersEq };
}

describe('requireRole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirects to /login?expired=true when no user', async () => {
    mockSupabase({ user: null });
    await expect(requireRole(['teacher'])).rejects.toThrow('REDIRECT:/login?expired=true');
  });

  it('redirects to /login when the user has no role row', async () => {
    mockSupabase({ user: { id: 'u1' }, profile: { role: null, school_id: null } });
    await expect(requireRole(['teacher'])).rejects.toThrow('REDIRECT:/login');
  });

  it('redirects to /trial-expired when the school trial is expired', async () => {
    mockSupabase({
      user: { id: 'u1' },
      profile: { role: 'teacher', school_id: 's1' },
      school: { trial_status: 'expired' },
    });
    await expect(requireRole(['teacher'])).rejects.toThrow('REDIRECT:/trial-expired');
  });

  it('redirects a wrong-role user to their own home', async () => {
    mockSupabase({
      user: { id: 'u1' },
      profile: { role: 'student', school_id: null },
    });
    await expect(requireRole(['teacher'])).rejects.toThrow('REDIRECT:/student/dashboard');
  });

  it('redirects a denied school_sysadmin to /admin/dashboard (school-tier, NOT /provision)', async () => {
    mockSupabase({
      user: { id: 'u1' },
      profile: { role: 'school_sysadmin', school_id: 's1' },
      school: { trial_status: 'active' },
    });
    await expect(requireRole(['teacher'])).rejects.toThrow('REDIRECT:/admin/dashboard');
  });

  it('redirects a denied platform_admin to /provision', async () => {
    mockSupabase({
      user: { id: 'u1' },
      profile: { role: 'platform_admin', school_id: null },
    });
    await expect(requireRole(['teacher'])).rejects.toThrow('REDIRECT:/provision');
  });

  it('returns context for an allowed role AND queries users with the right columns + id', async () => {
    const spies = mockSupabase({
      user: { id: 'u1' },
      profile: { role: 'teacher', school_id: 's1' },
      school: { trial_status: 'active' },
    });
    const ctx = await requireRole(['teacher']);
    expect(ctx).toEqual({ userId: 'u1', role: 'teacher', schoolId: 's1' });
    // Catch impl drift: wrong table/columns/filter would fail here.
    expect(spies.usersSelect).toHaveBeenCalledWith('role, school_id');
    expect(spies.usersEq).toHaveBeenCalledWith('id', 'u1');
  });
});
