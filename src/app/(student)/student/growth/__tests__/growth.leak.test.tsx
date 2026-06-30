// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hasDiagnosticVocab, hasLeak } from '@/lib/copy/leakGuard';

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: 's1' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/student/loadStudentGrowth', () => ({
  loadStudentGrowth: vi.fn().mockResolvedValue({
    gradeDirection: 'climbing',
    trendPoints: [{ date: '2026-06-01T00:00:00Z', grade: 80 }, { date: '2026-06-15T00:00:00Z', grade: 88 }],
    skills: [
      { skillName: 'Fractions', label: 'Building strength' },
      { skillName: 'Algebra', label: 'Solid' },
      { skillName: 'Geometry', label: 'Excelling' },
    ],
    latestHighFiveText: 'You kept going — that is real grit.',
    totalHighFiveCount: 3,
  }),
}));
vi.mock('@/components/core/GradeTrendSparkline', () => ({
  GradeTrendSparkline: ({ ariaLabel }: { ariaLabel: string }) => (
    <svg aria-label={ariaLabel} data-testid="sparkline" />
  ),
}));

import StudentGrowthPage from '@/app/(student)/student/growth/page';

describe('StudentGrowthPage — four-audience leak gate', () => {
  it('renders without any diagnostic vocab in visible text', async () => {
    render(await StudentGrowthPage());
    const allText = document.body.textContent ?? '';
    expect(hasDiagnosticVocab(allText)).toBe(false);
  });

  it('renders without numeric leaks in visible text', async () => {
    render(await StudentGrowthPage());
    // Grade digit CAN appear in the sparkline aria-label but not in body text prose.
    // Collect only <p>, <h1>, <h2>, <span>, <li> text.
    const nodes = Array.from(
      document.querySelectorAll('p, h1, h2, span, li')
    ).map(el => el.textContent ?? '');
    for (const text of nodes) {
      expect(hasLeak(text)).toBe(false);
    }
  });

  it('renders skill labels without any CL verb', async () => {
    render(await StudentGrowthPage());
    const skillTexts = Array.from(document.querySelectorAll('li')).map(el => el.textContent ?? '');
    for (const t of skillTexts) {
      expect(hasDiagnosticVocab(t)).toBe(false);
    }
  });
});
