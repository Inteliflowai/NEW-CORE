// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// class='c1' is provided, so the page never hits the no-class redirect branch — only these
// three mocks are exercised (no requireRole/firstClassIdForTeacher needed).
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createAdminSupabaseClient: () => ({}) }));
vi.mock('@/lib/insights/loadInsights', () => ({
  loadInsights: async () => ({
    band_mix: { needs_reinforcement: 1, on_track: 1, ready_to_enrich: 0, not_assessed: 0, total: 2 },
    observation: '2 students need another pass on Equivalent fractions.',
    concept_gaps: [],
    comprehension: {
      skills: [{ skill_id: 'sk1', skill_name: 'Equivalent fractions', reinforce: 2, on_track: 1, enrich: 0,
        reinforce_students: [{ student_id: 's1', full_name: 'Ava Ng' }], on_track_students: [], enrich_students: [] }],
      trend: { points: [{ date: '2026-05-04', index: 40 }, { date: '2026-05-11', index: 70 }, { date: '2026-05-18', index: 85 }], direction: 'climbing' },
    },
    learning_style: { styles: ['visual', 'hands-on'], line: 'Your class spans visual and hands-on learners — assignments differentiate to each.' },
  }),
}));

describe('Insights page renders the moat sections', () => {
  it('shows comprehension-by-skill, the trend, and the learning-style line', async () => {
    const { default: InsightsPage } = await import('@/app/(teacher)/insights/page');
    const ui = await InsightsPage({ searchParams: Promise.resolve({ class: 'c1' }) });
    render(ui);
    expect(screen.getByText('Comprehension by skill')).toBeInTheDocument();
    expect(screen.getByText(/has been climbing/i)).toBeInTheDocument();
    expect(screen.getByText(/differentiate to each/)).toBeInTheDocument();
  });
});
