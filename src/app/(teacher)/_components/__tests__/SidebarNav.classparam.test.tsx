// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Suite: a class IS selected → nav links must carry ?class= forward (the flash-fix
// truthy branch). The other SidebarNav suites mock empty params, exercising only the
// bare-href branch; this pins the param-carrying branch against silent regression.
vi.mock('next/navigation', () => ({
  usePathname: () => '/today',
  useSearchParams: () => new URLSearchParams('class=c9'),
}));
import { SidebarNav } from '../SidebarNav';

describe('SidebarNav — carries the active ?class= on nav links', () => {
  it('appends the selected class to every destination href', () => {
    render(<SidebarNav />);
    expect(screen.getByRole('link', { name: /Roster/i })).toHaveAttribute('href', '/roster?class=c9');
    expect(screen.getByRole('link', { name: /Today/i })).toHaveAttribute('href', '/today?class=c9');
    expect(screen.getByRole('link', { name: /Gradebook/i })).toHaveAttribute('href', '/gradebook?class=c9');
  });
});
