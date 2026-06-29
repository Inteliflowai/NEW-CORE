// src/app/(student)/__tests__/layout.guard.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('@/components/core/RoleLayout', () => ({ RoleLayout: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/core/HelpButton', () => ({ HelpButton: () => null }));
import StudentLayout from '../layout';
beforeEach(() => vi.clearAllMocks());
it('guards the student group with [student]', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'student', schoolId: 's1' });
  await StudentLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(['student']);
});
it('wires HelpButton into the student layout', () => {
  const src = readFileSync(resolve(__dirname, '../layout.tsx'), 'utf-8');
  expect(src).toContain("from '@/components/core/HelpButton'");
  expect(src).toContain('<HelpButton />');
});
