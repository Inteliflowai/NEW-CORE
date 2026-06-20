// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ usePathname: () => '/library/lessons/9' }));
import { TeacherTopbar, pageTitleFor, initialsOf, greetingFor } from '../TeacherTopbar';

describe('TeacherTopbar helpers', () => {
  it('pageTitleFor maps known prefixes, falls back to CORE', () => {
    expect(pageTitleFor('/today')).toBe('Today');
    expect(pageTitleFor('/students/abc')).toBe('Student');
    expect(pageTitleFor('/library/quizzes')).toBe('Quiz Library');
    expect(pageTitleFor('/nope')).toBe('CORE');
  });

  it('initialsOf derives up to two initials, fallback T', () => {
    expect(initialsOf('Ms. Mitchell')).toBe('MM');
    expect(initialsOf('Ana Silva')).toBe('AS');
    expect(initialsOf(null)).toBe('T');
  });

  it('greetingFor by hour', () => {
    expect(greetingFor(9)).toBe('Good morning');
    expect(greetingFor(14)).toBe('Good afternoon');
    expect(greetingFor(20)).toBe('Good evening');
  });
});

describe('TeacherTopbar', () => {
  it('fires onMenuClick when the menu button is pressed', () => {
    const onMenuClick = vi.fn();
    render(<TeacherTopbar userName="Ms. Mitchell" onMenuClick={onMenuClick} />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(onMenuClick).toHaveBeenCalledOnce();
  });
});
