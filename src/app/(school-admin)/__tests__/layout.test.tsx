// @vitest-environment jsdom
import '@/test/setup-dom';
import { render, screen } from '@testing-library/react';
import { it, expect, vi } from 'vitest';

// mock next/navigation usePathname → '/admin/overview'
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/overview',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { AdminShell } from '@/app/(school-admin)/_components/AdminShell';

it('hides Student Attention from IT', () => {
  render(<AdminShell userName="Sam" roleLabel="IT Admin" canSeeStudentAttention={false}>x</AdminShell>);
  expect(screen.queryByText('Student Attention')).toBeNull();
});
it('shows Student Attention to the academic head', () => {
  render(<AdminShell userName="Sam" roleLabel="School Admin" canSeeStudentAttention>x</AdminShell>);
  expect(screen.getByText('Student Attention')).toBeInTheDocument();
});
