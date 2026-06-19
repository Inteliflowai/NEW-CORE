// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeacherNav } from '../TeacherNav';

// ── Suite 1: /students/abc — Roster alias ──────────────────────────────────
vi.mock('next/navigation', () => ({
  usePathname: () => '/students/abc',
}));

describe('TeacherNav — /students/abc (Roster alias)', () => {
  it('renders all 9 destinations and 2 group labels', () => {
    render(<TeacherNav />);
    const labels = [
      'Today',
      'Roster',
      'Gradebook',
      'Alerts',
      'High Fives',
      'Lesson Library',
      'Quiz Library',
      'Insights',
      'Upload',
      'STUDENTS',
      'TEACHER',
    ];
    labels.forEach((text) => {
      expect(screen.getByText(text)).toBeInTheDocument();
    });
  });

  it('never renders the word "Homework"', () => {
    render(<TeacherNav />);
    expect(screen.queryByText(/Homework/i)).toBeNull();
  });

  it('exactly one link has aria-current="page" and it is Roster', () => {
    render(<TeacherNav />);
    const active = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent('Roster');
  });
});
