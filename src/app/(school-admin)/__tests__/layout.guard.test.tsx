// src/app/(school-admin)/__tests__/layout.guard.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SCHOOL_ADMIN_ROLES } from '@/lib/auth/roles';

const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));

// Stub the admin Supabase client so the layout does not make real HTTP calls.
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

// Stub AdminShell so the server-component test does not render a full client tree.
vi.mock('@/app/(school-admin)/_components/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/core/HelpButton', () => ({ HelpButton: () => null }));

import SchoolAdminLayout from '../layout';
beforeEach(() => vi.clearAllMocks());

it('guards the school-admin group with SCHOOL_ADMIN_ROLES (catches a hardcoded drift)', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'school_admin', schoolId: 's1', fullName: 'Sam' });
  await SchoolAdminLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(SCHOOL_ADMIN_ROLES);
});
it('wires HelpButton into the school-admin layout', () => {
  const src = readFileSync(resolve(__dirname, '../layout.tsx'), 'utf-8');
  expect(src).toContain("from '@/components/core/HelpButton'");
  expect(src).toContain('<HelpButton />');
});
