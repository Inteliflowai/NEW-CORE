// src/app/(school-admin)/admin/students/__tests__/page.test.tsx
// Page-level tests for the Student Attention rollup page.
// Covers: URL re-guard (sysadmin→redirect), PickASchool (no schoolId), happy-path render.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn((url: string) => { throw new Error('REDIRECT:' + url); });
const resolveAdminContext = vi.fn();
const loadStudentAttention = vi.fn();

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/school/resolveAdminContext', () => ({ resolveAdminContext }));
vi.mock('@/lib/school/loadStudentAttention', () => ({ loadStudentAttention }));
vi.mock('@/lib/supabase/server', () => ({ createAdminSupabaseClient: () => ({}) }));
// Stub heavy components so the server-component render is lightweight
vi.mock('@/app/(school-admin)/_components/PickASchool', () => ({
  PickASchool: () => 'PickASchool',
}));
vi.mock(
  '@/app/(school-admin)/admin/students/_components/AttentionRollup',
  () => ({ AttentionRollup: () => 'AttentionRollup' }),
);

async function load() {
  vi.resetModules();
  return (await import('@/app/(school-admin)/admin/students/page')).default;
}

const emptyData = { grades: [] };

beforeEach(() => {
  vi.clearAllMocks();
  resolveAdminContext.mockResolvedValue({
    userId: 'u1',
    role: 'school_admin',
    fullName: 'Sam',
    schoolId: 's1',
    isPlatform: false,
    caps: { canSeeStudentAttention: true },
  });
  loadStudentAttention.mockResolvedValue(emptyData);
});

describe('StudentAttentionPage', () => {
  it('redirects to /admin/overview when canSeeStudentAttention is false (IT role)', async () => {
    resolveAdminContext.mockResolvedValue({
      userId: 'u2',
      role: 'school_sysadmin',
      fullName: null,
      schoolId: 's1',
      isPlatform: false,
      caps: { canSeeStudentAttention: false },
    });
    const Page = await load();
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'REDIRECT:/admin/overview',
    );
    expect(redirect).toHaveBeenCalledWith('/admin/overview');
  });

  it('returns PickASchool when canSeeStudentAttention=true but schoolId is null', async () => {
    resolveAdminContext.mockResolvedValue({
      userId: 'u3',
      role: 'platform_admin',
      fullName: null,
      schoolId: null,
      isPlatform: true,
      caps: { canSeeStudentAttention: true },
    });
    const Page = await load();
    const el = await Page({ searchParams: Promise.resolve({}) });
    expect(el).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('renders AttentionRollup when authorized with a schoolId', async () => {
    const Page = await load();
    const el = await Page({ searchParams: Promise.resolve({}) });
    expect(el).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
    expect(loadStudentAttention).toHaveBeenCalledWith(expect.anything(), 's1');
  });
});
