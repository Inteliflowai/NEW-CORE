// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: 's1' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({}),
}));

const { growthFn } = vi.hoisted(() => ({ growthFn: vi.fn() }));
vi.mock('@/lib/student/loadStudentGrowth', () => ({ loadStudentGrowth: growthFn }));
vi.mock('@/components/core/GradeTrendSparkline', () => ({
  GradeTrendSparkline: ({ coldStartLabel }: { coldStartLabel?: string }) => (
    <div data-testid="sparkline">{coldStartLabel}</div>
  ),
}));

import StudentGrowthPage from '@/app/(student)/student/growth/page';

describe('StudentGrowthPage', () => {
  it('shows cold-start sparkline text when no trend data', async () => {
    growthFn.mockResolvedValue({
      gradeDirection: null,
      trendPoints: [],
      skills: [],
      latestHighFiveText: null,
      totalHighFiveCount: 0,
    });
    render(await StudentGrowthPage());
    expect(screen.getByText(/here is how you are doing/i)).toBeInTheDocument();
    expect(screen.getByTestId('sparkline')).toBeInTheDocument();
  });

  it('shows skills section when skills present', async () => {
    growthFn.mockResolvedValue({
      gradeDirection: 'climbing',
      trendPoints: [{ date: '2026-06-01', grade: 80 }, { date: '2026-06-15', grade: 88 }],
      skills: [{ skillName: 'Fractions', label: 'Building strength' }],
      latestHighFiveText: null,
      totalHighFiveCount: 0,
    });
    render(await StudentGrowthPage());
    expect(screen.getByText('Fractions')).toBeInTheDocument();
    expect(screen.getByText('Building strength')).toBeInTheDocument();
    expect(screen.getByText(/effort lately/i)).toBeInTheDocument();
  });

  it('shows high-five teaser and see-all link when notes exist', async () => {
    growthFn.mockResolvedValue({
      gradeDirection: null,
      trendPoints: [],
      skills: [],
      latestHighFiveText: 'Keep it up!',
      totalHighFiveCount: 4,
    });
    render(await StudentGrowthPage());
    expect(screen.getByText('Keep it up!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /see all/i })).toHaveAttribute('href', '/student/notes');
  });

  it('hides see-all link when only 1 note', async () => {
    growthFn.mockResolvedValue({
      gradeDirection: null,
      trendPoints: [],
      skills: [],
      latestHighFiveText: 'Great!',
      totalHighFiveCount: 1,
    });
    render(await StudentGrowthPage());
    expect(screen.queryByRole('link', { name: /see all/i })).not.toBeInTheDocument();
  });
});
