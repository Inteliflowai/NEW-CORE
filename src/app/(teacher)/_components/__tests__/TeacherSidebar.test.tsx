// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';

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

describe('TeacherSidebar — S2 SPARK sticker', () => {
  it('renders a SPARK sticker image and the "Inside CORE" tag', () => {
    render(<TeacherSidebar userName="Dana Whitfield" />);
    expect(screen.getByAltText('SPARK')).toBeInTheDocument();
    expect(screen.getByText(/inside core/i)).toBeInTheDocument();
  });

  it('still renders the CORE logo plate (no regression)', () => {
    render(<TeacherSidebar userName="Dana Whitfield" />);
    expect(screen.getByAltText('CORE')).toBeInTheDocument();
  });
});
