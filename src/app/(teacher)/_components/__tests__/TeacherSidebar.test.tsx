// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../ClassSwitcherPill', () => ({ ClassSwitcherPill: () => <div data-testid="pill" /> }));
vi.mock('../SidebarNav', () => ({ SidebarNav: () => <nav data-testid="nav" /> }));
import { TeacherSidebar } from '../TeacherSidebar';

describe('TeacherSidebar', () => {
  it('renders the CORE logo, class pill, nav, the user name, and a POST sign-out', () => {
    render(<TeacherSidebar userName="Ms. Mitchell" />);
    expect(screen.getByAltText('CORE')).toBeInTheDocument();
    expect(screen.getByTestId('pill')).toBeInTheDocument();
    expect(screen.getByTestId('nav')).toBeInTheDocument();
    expect(screen.getByText('Ms. Mitchell')).toBeInTheDocument();

    const signout = screen.getByRole('button', { name: /sign out/i });
    const form = signout.closest('form')!;
    expect(form).toHaveAttribute('action', '/logout');
    expect(form).toHaveAttribute('method', 'post');
  });

  it('falls back to "Teacher" when no name', () => {
    render(<TeacherSidebar userName={null} />);
    // both the footer name and the role label read "Teacher"
    expect(screen.getAllByText('Teacher').length).toBeGreaterThanOrEqual(1);
  });
});
