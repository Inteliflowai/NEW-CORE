// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Suite: /today — exact match
vi.mock('next/navigation', () => ({ usePathname: () => '/today', useSearchParams: () => new URLSearchParams() }));
import { SidebarNav } from '../SidebarNav';

describe('SidebarNav — /today (exact match)', () => {
  it('exactly one link is aria-current=page and it is Today', () => {
    render(<SidebarNav />);
    const active = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent('Today');
  });
});
