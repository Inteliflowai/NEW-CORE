// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeacherNav } from '../TeacherNav';

// ── Suite 3: /today — exact match ─────────────────────────────────────────
vi.mock('next/navigation', () => ({
  usePathname: () => '/today',
}));

describe('TeacherNav — /today (exact match)', () => {
  it('exactly one link has aria-current="page" and it is Today', () => {
    render(<TeacherNav />);
    const active = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent('Today');
  });
});
