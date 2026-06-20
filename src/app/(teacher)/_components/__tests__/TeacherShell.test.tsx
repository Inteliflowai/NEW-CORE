// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mutable so we can simulate a route change across renders.
let path = '/today';
vi.mock('next/navigation', () => ({ usePathname: () => path }));
vi.mock('../TeacherSidebar', () => ({ TeacherSidebar: () => <div data-testid="sidebar" /> }));
import { TeacherShell } from '../TeacherShell';

describe('TeacherShell', () => {
  beforeEach(() => {
    path = '/today';
  });

  it('sets role/intensity, renders children, and exactly one rail when closed', () => {
    const { container } = render(<TeacherShell userName="X">hello</TeacherShell>);
    const root = container.querySelector('[data-role="teacher"]')!;
    expect(root.getAttribute('data-intensity')).toBe('calm');
    expect(screen.getByText('hello')).toBeInTheDocument();
    // Closed: only the persistent lg rail is mounted (drawer is mount-on-open).
    expect(screen.getAllByTestId('sidebar')).toHaveLength(1);
    expect(screen.queryByTestId('drawer-backdrop')).toBeNull();
  });

  it('menu button opens the drawer (2nd rail + backdrop) and toggles it closed', () => {
    render(<TeacherShell userName="X">hi</TeacherShell>);
    const menu = screen.getByRole('button', { name: /open menu/i });

    fireEvent.click(menu);
    expect(screen.getByTestId('drawer-backdrop')).toBeInTheDocument();
    expect(screen.getAllByTestId('sidebar')).toHaveLength(2); // static rail + drawer rail

    // The menu button is a toggle — a second click closes it.
    fireEvent.click(menu);
    expect(screen.queryByTestId('drawer-backdrop')).toBeNull();
    expect(screen.getAllByTestId('sidebar')).toHaveLength(1);
  });

  it('closes the drawer via the backdrop', () => {
    render(<TeacherShell userName="X">hi</TeacherShell>);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(screen.queryByTestId('drawer-backdrop')).toBeNull();
  });

  it('closes the drawer on navigation (pathname change)', () => {
    const { rerender } = render(<TeacherShell userName="X">hi</TeacherShell>);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByTestId('drawer-backdrop')).toBeInTheDocument();

    // Simulate a route change → the [pathname] effect should close the drawer.
    path = '/roster';
    rerender(<TeacherShell userName="X">hi</TeacherShell>);
    expect(screen.queryByTestId('drawer-backdrop')).toBeNull();
  });
});
