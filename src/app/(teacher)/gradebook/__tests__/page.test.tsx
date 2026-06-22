import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireRole = vi.fn(); const firstClassIdForTeacher = vi.fn(); const guardClassAccess = vi.fn();
const loadGradebook = vi.fn(); const redirect = vi.fn((url: string) => { throw new Error('REDIRECT:' + url); });

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('@/lib/teacher/firstClassIdForTeacher', () => ({ firstClassIdForTeacher }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/supabase/server', () => ({ createAdminSupabaseClient: () => ({}) }));
vi.mock('@/lib/gradebook/loadGradebook', () => ({ loadGradebook }));

async function load() { vi.resetModules(); return (await import('@/app/(teacher)/gradebook/page')).default; }

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue({ userId: 't1' });
  firstClassIdForTeacher.mockReset().mockResolvedValue('c1');
  guardClassAccess.mockReset().mockResolvedValue(null);
  loadGradebook.mockReset().mockResolvedValue({ class_id: 'c1', students: [{ student_id: 's1', name: 'Ana' }], assignments: [], cells: { s1: {} }, class_average: null, column_averages: {}, missing_count: 0, quizzes: [], quiz_cells: { s1: {} } });
});

describe('GradebookPage', () => {
  it('redirects to the first class when no class param is given', async () => {
    const Page = await load();
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/gradebook?class=c1');
  });
  it('loads the gradebook when a class is provided and guard passes', async () => {
    const Page = await load();
    const el = await Page({ searchParams: Promise.resolve({ class: 'c1' }) });
    expect(loadGradebook).toHaveBeenCalledWith(expect.anything(), { classId: 'c1', teacherId: 't1' });
    expect(el).toBeTruthy();
  });
});
