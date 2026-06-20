// src/app/(teacher)/__tests__/layout.guard.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('../_components/TeacherShell', () => ({
  TeacherShell: ({ children }: { children: React.ReactNode }) => children,
}));
import TeacherLayout from '../layout';
beforeEach(() => vi.clearAllMocks());
it('guards the teacher group with [teacher]', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'teacher', schoolId: 's1', fullName: 'Ms. Mitchell' });
  await TeacherLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(['teacher']);
});
