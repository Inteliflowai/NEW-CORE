// src/app/(school-admin)/admin/students/[studentId]/__tests__/page.test.tsx
// Page-level tests for the admin-scoped student drill-in (OPTION A).
// Covers: capability guard, IDOR (student not in school), happy-path render.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn((url: string) => { throw new Error('REDIRECT:' + url); });
const resolveAdminContext = vi.fn();

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/school/resolveAdminContext', () => ({ resolveAdminContext }));

// Admin client mock — table-aware: 'users' returns a student row (or not);
// 'student_model_snapshots' returns band rows.
function makeAdminMock(studentFound: boolean) {
  function makeChain(table: string) {
    const q: Record<string, unknown> = {};
    const c = () => q;
    q.select = c;
    q.eq = c;
    q.in = c;
    q.order = c;
    q.limit = c;

    q.maybeSingle = () =>
      Promise.resolve({
        data:
          table === 'users' && studentFound
            ? { id: 's1', full_name: 'Alice Green', grade_level: '7', school_id: 'school-123' }
            : null,
        error: null,
      });

    (q as { then: unknown }).then = (
      resolve: (v: { data: unknown; error: null }) => void,
    ) => {
      const data =
        table === 'student_model_snapshots' && studentFound
          ? [
              { mastery_band: 'reteach', skill_id: 'skill-abc', snapshot_date: '2026-06-14' },
              { mastery_band: 'grade_level', skill_id: 'skill-xyz', snapshot_date: '2026-06-14' },
            ]
          : [];
      resolve({ data, error: null });
    };
    return q;
  }
  return { from: (table: string) => makeChain(table) };
}

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: vi.fn(),
}));

import { createAdminSupabaseClient } from '@/lib/supabase/server';
const mockCreateAdmin = vi.mocked(createAdminSupabaseClient);

async function load() {
  vi.resetModules();
  return (
    await import('@/app/(school-admin)/admin/students/[studentId]/page')
  ).default;
}

const baseCtx = {
  userId: 'u1',
  role: 'school_admin',
  fullName: 'Sam',
  schoolId: 'school-123',
  isPlatform: false,
  caps: { canSeeStudentAttention: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveAdminContext.mockResolvedValue(baseCtx);
  mockCreateAdmin.mockReturnValue(makeAdminMock(true) as unknown as ReturnType<typeof createAdminSupabaseClient>);
});

describe('AdminStudentDrillIn', () => {
  it('redirects to /admin/overview when canSeeStudentAttention is false', async () => {
    resolveAdminContext.mockResolvedValue({
      ...baseCtx,
      role: 'school_sysadmin',
      caps: { canSeeStudentAttention: false },
    });
    const Page = await load();
    await expect(
      Page({
        params: Promise.resolve({ studentId: 's1' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('REDIRECT:/admin/overview');
    expect(redirect).toHaveBeenCalledWith('/admin/overview');
  });

  it('redirects to /admin/students when schoolId is null', async () => {
    resolveAdminContext.mockResolvedValue({
      ...baseCtx,
      schoolId: null,
    });
    const Page = await load();
    await expect(
      Page({
        params: Promise.resolve({ studentId: 's1' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('REDIRECT:/admin/students');
    expect(redirect).toHaveBeenCalledWith('/admin/students');
  });

  it('redirects to /admin/students when the student is not in this school (IDOR guard)', async () => {
    mockCreateAdmin.mockReturnValue(makeAdminMock(false) as unknown as ReturnType<typeof createAdminSupabaseClient>);
    const Page = await load();
    await expect(
      Page({
        params: Promise.resolve({ studentId: 's-other-school' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('REDIRECT:/admin/students');
    expect(redirect).toHaveBeenCalledWith('/admin/students');
  });

  it('renders the student name and grade on the happy path', async () => {
    const Page = await load();
    const el = await Page({
      params: Promise.resolve({ studentId: 's1' }),
      searchParams: Promise.resolve({}),
    });
    expect(el).toBeTruthy();
    // The JSX should contain the student name somewhere in the element tree
    const html = JSON.stringify(el);
    expect(html).toContain('Alice Green');
    expect(html).toContain('7');
  });

  it('does NOT redirect on the happy path', async () => {
    const Page = await load();
    await Page({
      params: Promise.resolve({ studentId: 's1' }),
      searchParams: Promise.resolve({}),
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});
