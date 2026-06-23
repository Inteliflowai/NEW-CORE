// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { coachObservation } from '@/lib/copy/coachObservation';

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/students/x',
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({}),
}));

vi.mock('@/lib/auth/guards', () => ({
  guardStudentAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/signals/loadStudentSignals', () => ({
  loadStudentSignals: vi.fn(),
}));

vi.mock('@/lib/signals/loadStudentIdentity', () => ({
  loadStudentIdentity: vi.fn(),
}));

// The page now also loads a per-student grade trend when a class is in context. Mock it to an
// empty trend so the page renders the cold-start (no digits) — leaving the leak whitelist intact.
vi.mock('@/lib/gradebook/loadStudentGradeTrend', () => ({
  loadStudentGradeTrend: vi.fn().mockResolvedValue({ points: [], direction: null, latest: null, average: null }),
}));

import { loadStudentSignals } from '@/lib/signals/loadStudentSignals';
import { loadStudentIdentity } from '@/lib/signals/loadStudentIdentity';
import type { StudentSignals } from '@/lib/signals/loadStudentSignals';

const mockSignals = vi.mocked(loadStudentSignals);
const mockIdentity = vi.mocked(loadStudentIdentity);

// ── Leak fixture — every distinctive raw number must be suppressed ────────────
// risk_score=87, session.score=0.93, consistency_score=41, growth numbers 11/22/33/44,
// raw confidence is never in the payload (only confidence_label). skill_id 'sk:secret'
// must never appear. The ONLY raw numbers allowed: divergence hw/quiz (82/52) and the
// reteach delta (improvement 27).
const LEAK_FIXTURE: StudentSignals = {
  student_id: 'leak-stu',
  current_band: 'grade_level',
  per_skill_cl: [
    {
      skill_id: 'sk:secret',
      skill_name: 'Adding Fractions',
      state: 'needs_different_instruction',
      cl_verb: 'Reinforce',
      cl_display: 'Reinforce',
      confidence_label: 'tentative',
    },
  ],
  recurring_misconceptions: [
    { skill_id: 'sk:secret', recurring_error: { type: 'sign_error', count: 9 } },
  ],
  divergence: {
    divergence_score: 30,
    divergence_direction: 'hw_higher',
    divergence_trend: 'widening',
    hw_avg: 82,
    quiz_avg: 52,
    divergence_flagged: true,
  },
  effort: { dominant_effort_pattern: 'high' },
  risk: {
    roster: { risk_score: 87, risk_level: 'high', risk_factors: ['Low average quiz score (48%)'] },
    session: { score: 0.93, factors: ['rushing'] },
  },
  reteach_outcomes: [
    {
      student_id: 'leak-stu',
      assignment_id: 'a1',
      original_attempt_id: 'o1',
      redo_attempt_id: 'r1',
      pre_score: 40,
      post_score: 67,
      improvement: 27,
      flagged_by: 'teacher',
      completed_at: '2026-06-01T00:00:00Z',
    },
  ],
  trajectory: {
    consistency_score: 41,
    consistency_label: 'variable',
    trajectory: 'improving',
  },
  growth_history: [11, 22, 33, 44],
  // Drive the REAL coachObservation for this high-risk student so the high-roster-risk
  // DOM path is exercised by production code (not a hand-clean fixture): with risk_level
  // 'high' and a cold-start model it returns the leak-safe "recent quizzes have dipped" watch.
  coach_read: coachObservation({ computed: null, observationCount: 0, firstName: 'Jordan', rosterRisk: { risk_level: 'high' } }),
};

async function renderPage() {
  const { default: StudentPage } = await import('../page');
  return render(
    await StudentPage({
      params: Promise.resolve({ studentId: 'leak-stu' }),
      searchParams: Promise.resolve({ from: 'roster', class: 'c9' }),
    }),
  );
}

describe('One-Student page — leak discipline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignals.mockResolvedValue(LEAK_FIXTURE);
    mockIdentity.mockResolvedValue({
      id: 'leak-stu',
      full_name: 'Jordan Rivers',
      display_name: null,
      grade_level: '7',
    });
  });

  it('does NOT render the raw risk_score (87)', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).not.toContain('87');
  });

  it('does NOT render the raw session score (0.93 / 93)', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).not.toContain('0.93');
    expect(container.innerHTML).not.toContain('93');
  });

  it('does NOT render the raw consistency_score (41)', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).not.toContain('41');
  });

  it('does NOT render the raw growth_history numbers (11/22/33/44)', async () => {
    const { container } = await renderPage();
    const html = container.innerHTML;
    expect(html).not.toContain('>11<');
    expect(html).not.toContain('>22<');
    expect(html).not.toContain('>33<');
    expect(html).not.toContain('>44<');
  });

  it('does NOT render the opaque skill_id (sk:secret)', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).not.toContain('sk:secret');
  });

  it('does NOT render the raw risk_factor percentage (48%)', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).not.toContain('48%');
  });

  it('renders the coach-read observation (real helper) and never the raw risk factor', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('dipped');           // the leak-safe fallback line
    expect(container.innerHTML).not.toContain('Low average quiz score'); // factor words never rendered
  });

  it('renders the skill_name and the CL verb (teacher-facing)', async () => {
    const { container } = await renderPage();
    const html = container.innerHTML;
    expect(html).toContain('Adding Fractions');
    expect(html).toContain('Reinforce');
  });

  it('ALLOWS the divergence Assignment/quiz numbers (82, 52) — teacher-only by design', async () => {
    const { container } = await renderPage();
    const html = container.innerHTML;
    expect(html).toContain('82');
    expect(html).toContain('52');
    // says "Assignment", never "HW"/"Homework"
    expect(html.toLowerCase()).toContain('assignment');
    expect(html).not.toMatch(/\bHW\b/);
    expect(html.toLowerCase()).not.toContain('homework');
  });

  it('ALLOWS the reteach delta (+27 pts) — teacher-only by design', async () => {
    const { container } = await renderPage();
    expect(container.innerHTML).toContain('27');
  });
});
