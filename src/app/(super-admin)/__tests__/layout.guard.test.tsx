// src/app/(super-admin)/__tests__/layout.guard.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('@/components/core/RoleLayout', () => ({ RoleLayout: ({ children }: { children: React.ReactNode }) => children }));
import SuperAdminLayout from '../layout';
beforeEach(() => vi.clearAllMocks());
it('guards the super-admin group with [platform_admin]', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'platform_admin', schoolId: null });
  await SuperAdminLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(['platform_admin']);
});
