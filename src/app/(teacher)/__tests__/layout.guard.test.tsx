// src/app/(teacher)/__tests__/layout.guard.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
const requireRole = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
vi.mock('../_components/TeacherShell', () => ({
  TeacherShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/core/HelpButton', () => ({ HelpButton: () => null }));
import TeacherLayout from '../layout';
beforeEach(() => vi.clearAllMocks());
it('guards the teacher group with [teacher]', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'teacher', schoolId: 's1', fullName: 'Ms. Mitchell' });
  await TeacherLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(['teacher']);
});
it('wires HelpButton into the teacher layout', () => {
  const src = readFileSync(resolve(__dirname, '../layout.tsx'), 'utf-8');
  expect(src).toContain("from '@/components/core/HelpButton'");
  expect(src).toContain('<HelpButton />');
});
