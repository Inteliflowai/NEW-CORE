// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/students/x',
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminSupabaseClient: () => ({}) }));
vi.mock('@/lib/auth/guards', () => ({ guardStudentAccess: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/signals/loadStudentSignals', () => ({ loadStudentSignals: vi.fn() }));
vi.mock('@/lib/signals/loadStudentIdentity', () => ({ loadStudentIdentity: vi.fn() }));
// Per-student grade trend loads when a class is in context — mock to an empty trend (cold-start).
vi.mock('@/lib/gradebook/loadStudentGradeTrend', () => ({
  loadStudentGradeTrend: vi.fn().mockResolvedValue({ points: [], direction: null, latest: null, average: null }),
}));

import { loadStudentSignals } from '@/lib/signals/loadStudentSignals';
import { loadStudentIdentity } from '@/lib/signals/loadStudentIdentity';
import { guardStudentAccess } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import type { StudentSignals } from '@/lib/signals/loadStudentSignals';

const mockSignals = vi.mocked(loadStudentSignals);
const mockIdentity = vi.mocked(loadStudentIdentity);
const mockGuard = vi.mocked(guardStudentAccess);
const mockRedirect = vi.mocked(redirect);

function baseSignals(overrides: Partial<StudentSignals> = {}): StudentSignals {
  return {
    student_id: 's1',
    current_band: 'grade_level',
    per_skill_cl: [],
    recurring_misconceptions: [],
    divergence: {
      divergence_score: 5,
      divergence_direction: 'aligned',
      divergence_trend: null,
      hw_avg: 70,
      quiz_avg: 72,
      divergence_flagged: false,
    },
    effort: { dominant_effort_pattern: 'medium' },
    risk: {
      roster: { risk_score: 10, risk_level: 'low', risk_factors: [] },
      session: { score: 0.1, factors: [] },
    },
    reteach_outcomes: [],
    trajectory: { consistency_score: 80, consistency_label: 'consistent', trajectory: 'stable' },
    growth_history: [],
    coach_read: { state: 'quiet', eyebrow: 'Still settling in', line: 'Still getting to know how Sam works.', suggestion: null, tone: 'ok' },
    ...overrides,
  };
}

async function renderPage(searchParams: { from?: string; class?: string } = {}) {
  const { default: StudentPage } = await import('../page');
  return render(
    await StudentPage({
      params: Promise.resolve({ studentId: 's1' }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

describe('One-Student page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGuard.mockResolvedValue(null);
    mockSignals.mockResolvedValue(baseSignals());
    mockIdentity.mockResolvedValue({
      id: 's1',
      full_name: 'Sam Lee',
      display_name: null,
      grade_level: '6',
    });
  });

  it('redirects to /roster when guardStudentAccess fails', async () => {
    const { NextResponse } = await import('next/server');
    mockGuard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    await expect(renderPage()).rejects.toThrow('REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/roster');
  });

  it('renders the real full_name and grade', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('Sam Lee');
    expect(container.innerHTML).toContain('Grade 6');
  });

  it('renders a breadcrumb back to Roster using ?class', async () => {
    const { container } = await renderPage({ from: 'roster', class: 'c1' });
    expect(container.innerHTML).toContain('/roster?class=c1');
    expect(container.innerHTML).toContain('Roster');
  });

  it('renders a Today breadcrumb when from=today', async () => {
    const { container } = await renderPage({ from: 'today', class: 'c1' });
    expect(container.innerHTML).toContain('Today');
  });

  it('priority CTA = review-risk when roster risk is high', async () => {
    mockSignals.mockResolvedValue(
      baseSignals({
        risk: {
          roster: { risk_score: 80, risk_level: 'high', risk_factors: ['Low quiz average'] },
          session: { score: 0.1, factors: [] },
        },
      }),
    );
    const { container } = await renderPage();
    expect(container.innerHTML).toContain("Review what's going on");
  });

  it('priority CTA = flag-reteach naming the top Reinforce skill', async () => {
    mockSignals.mockResolvedValue(
      baseSignals({
        per_skill_cl: [
          {
            skill_id: 'k1',
            skill_name: 'Long Division',
            state: 'needs_more_time',
            cl_verb: 'Reinforce',
            cl_display: 'Reinforce',
            confidence_label: 'tentative',
          },
        ],
      }),
    );
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('Flag Long Division for reteach');
  });

  it('falls back to Open Assignments CTA when nothing is flagged', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('Open Assignments');
  });

  it('shows GrowthMotif cold-start when fewer than 4 growth points', async () => {
    mockSignals.mockResolvedValue(baseSignals({ growth_history: [50, 60] }));
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('just getting started');
  });

  it('hides "A pattern worth knowing" when divergence is not flagged', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).not.toContain('A pattern worth knowing');
  });

  it('shows "A pattern worth knowing" when divergence is flagged', async () => {
    mockSignals.mockResolvedValue(
      baseSignals({
        divergence: {
          divergence_score: 30,
          divergence_direction: 'quiz_higher',
          divergence_trend: 'stable',
          hw_avg: 50,
          quiz_avg: 80,
          divergence_flagged: true,
        },
      }),
    );
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('A pattern worth knowing');
  });

  it('shows the coach-read in the Worth-a-look card when nothing is notable', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('Still settling in');
  });

  it('renders the Skill Map heading', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('Skill Map');
  });
});
