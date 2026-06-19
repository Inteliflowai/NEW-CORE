// src/app/(teacher)/__tests__/layout.guard.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('@/components/core/RoleLayout', () => ({ RoleLayout: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../_components/TeacherNav', () => ({ TeacherNav: () => null }));
vi.mock('../_components/ClassSwitcherPill', () => ({ ClassSwitcherPill: () => null }));
import TeacherLayout from '../layout';
beforeEach(() => vi.clearAllMocks());
it('guards the teacher group with [teacher]', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'teacher', schoolId: 's1' });
  await TeacherLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(['teacher']);
});
