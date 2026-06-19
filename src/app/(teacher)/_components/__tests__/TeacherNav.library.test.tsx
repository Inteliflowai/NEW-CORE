// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeacherNav } from '../TeacherNav';

// ── Suite 2: /library/lessons/123 — Lesson Library prefix match ───────────
vi.mock('next/navigation', () => ({
  usePathname: () => '/library/lessons/123',
}));

describe('TeacherNav — /library/lessons/123', () => {
  it('exactly one link has aria-current="page" and it is Lesson Library', () => {
    render(<TeacherNav />);
    const active = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent('Lesson Library');
  });
});
