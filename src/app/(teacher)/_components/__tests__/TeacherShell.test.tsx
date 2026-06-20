// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/today' }));
vi.mock('../TeacherSidebar', () => ({ TeacherSidebar: () => <div data-testid="sidebar" /> }));
import { TeacherShell } from '../TeacherShell';

describe('TeacherShell', () => {
  it('sets role/intensity and renders children + sidebar', () => {
    const { container } = render(<TeacherShell userName="X">hello</TeacherShell>);
    const root = container.querySelector('[data-role="teacher"]')!;
    expect(root.getAttribute('data-intensity')).toBe('calm');
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getAllByTestId('sidebar').length).toBeGreaterThan(0);
  });

  it('opens the drawer on menu click and closes it via the backdrop', () => {
    render(<TeacherShell userName="X">hi</TeacherShell>);
    expect(screen.queryByTestId('drawer-backdrop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByTestId('drawer-backdrop')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(screen.queryByTestId('drawer-backdrop')).toBeNull();
  });
});
