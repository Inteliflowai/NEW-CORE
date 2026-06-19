// src/app/(school-admin)/__tests__/layout.guard.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { SCHOOL_ADMIN_ROLES } from '@/lib/auth/roles';
const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('@/components/core/RoleLayout', () => ({ RoleLayout: ({ children }: { children: React.ReactNode }) => children }));
import SchoolAdminLayout from '../layout';
beforeEach(() => vi.clearAllMocks());
it('guards the school-admin group with SCHOOL_ADMIN_ROLES (catches a hardcoded drift)', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'school_admin', schoolId: 's1' });
  await SchoolAdminLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(SCHOOL_ADMIN_ROLES);
});
