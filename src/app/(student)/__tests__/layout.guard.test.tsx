// src/app/(student)/__tests__/layout.guard.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('@/components/core/RoleLayout', () => ({ RoleLayout: ({ children }: { children: React.ReactNode }) => children }));
import StudentLayout from '../layout';
beforeEach(() => vi.clearAllMocks());
it('guards the student group with [student]', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'student', schoolId: 's1' });
  await StudentLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(['student']);
});
