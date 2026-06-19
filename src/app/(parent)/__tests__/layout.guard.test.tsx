// src/app/(parent)/__tests__/layout.guard.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('@/components/core/RoleLayout', () => ({ RoleLayout: ({ children }: { children: React.ReactNode }) => children }));
import ParentLayout from '../layout';
beforeEach(() => vi.clearAllMocks());
it('guards the parent group with [parent]', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'parent', schoolId: 's1' });
  await ParentLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(['parent']);
});
