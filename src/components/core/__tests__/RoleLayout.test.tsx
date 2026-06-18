// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/test/setup-dom';
import { RoleLayout, type Role } from '../RoleLayout';

describe('RoleLayout', () => {
  it('renders children inside the layout', () => {
    render(
      <RoleLayout role="student">
        <span data-testid="child">hello</span>
      </RoleLayout>
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('renders the ◆ CORE mark', () => {
    render(<RoleLayout role="teacher">content</RoleLayout>);
    expect(screen.getByText('◆ CORE')).toBeTruthy();
  });

  it('sets data-role="student" on the root element', () => {
    const { container } = render(<RoleLayout role="student">x</RoleLayout>);
    expect(container.firstElementChild?.getAttribute('data-role')).toBe('student');
  });

  it('sets data-intensity="loud" for student role', () => {
    const { container } = render(<RoleLayout role="student">x</RoleLayout>);
    expect(container.firstElementChild?.getAttribute('data-intensity')).toBe('loud');
  });

  it.each<[Role, string]>([
    ['teacher', 'calm'],
    ['parent', 'calm'],
    ['admin', 'calm'],
    ['super-admin', 'calm'],
  ])('sets data-intensity="calm" for role %s', (role, expected) => {
    const { container } = render(<RoleLayout role={role}>x</RoleLayout>);
    expect(container.firstElementChild?.getAttribute('data-intensity')).toBe(expected);
  });

  it.each<Role>(['teacher', 'parent', 'admin', 'super-admin'])(
    'sets data-role="%s" correctly',
    (role) => {
      const { container } = render(<RoleLayout role={role}>x</RoleLayout>);
      expect(container.firstElementChild?.getAttribute('data-role')).toBe(role);
    }
  );

  it('renders an optional nav slot', () => {
    render(
      <RoleLayout role="teacher" nav={<a href="/home">Home</a>}>
        content
      </RoleLayout>
    );
    expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();
  });
});
