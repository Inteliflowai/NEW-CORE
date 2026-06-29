// src/app/(super-admin)/__tests__/layout.guard.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('@/components/core/RoleLayout', () => ({ RoleLayout: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/core/HelpButton', () => ({ HelpButton: () => null }));
import SuperAdminLayout from '../layout';
beforeEach(() => vi.clearAllMocks());
it('guards the super-admin group with [platform_admin]', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'platform_admin', schoolId: null });
  await SuperAdminLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(['platform_admin']);
});
it('wires HelpButton into the super-admin layout', () => {
  const src = readFileSync(resolve(__dirname, '../layout.tsx'), 'utf-8');
  expect(src).toContain("from '@/components/core/HelpButton'");
  expect(src).toContain('<HelpButton />');
});
it('exposes /platform/support nav link in super-admin layout', () => {
  const src = readFileSync(resolve(__dirname, '../layout.tsx'), 'utf-8');
  expect(src).toContain('/platform/support');
});
