// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Suite: /students/abc — Roster alias
vi.mock('next/navigation', () => ({ usePathname: () => '/students/abc', useSearchParams: () => new URLSearchParams() }));
import { SidebarNav } from '../SidebarNav';

describe('SidebarNav — /students/abc (Roster alias)', () => {
  it('renders 9 destinations + 3 group labels, no "Homework"', () => {
    render(<SidebarNav />);
    [
      'Today', 'Class Roster', 'Gradebook', 'Alerts', 'High Fives',
      'Lesson Library', 'Quiz Library', 'Insights', 'Import Roster',
      'CLASS', 'LIBRARY', 'INSIGHTS & TOOLS',
    ].forEach((t) => expect(screen.getByText(t)).toBeInTheDocument());
    expect(screen.queryByText(/Homework/i)).toBeNull();
  });

  it('exactly one link is aria-current=page and it is Class Roster', () => {
    render(<SidebarNav />);
    const active = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent('Class Roster');
  });
});
