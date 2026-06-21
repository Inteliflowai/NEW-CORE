// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// ── Mocks — all declared before imports ──────────────────────────────────────

// redirect throws like the real next/navigation redirect, so we can assert its target.
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error('REDIRECT:' + url);
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/today',
  redirect,
}));

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: 't1', role: 'teacher', schoolId: null, fullName: null }),
}));

vi.mock('@/lib/teacher/firstClassIdForTeacher', () => ({
  firstClassIdForTeacher: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({}),
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/auth/guards', () => ({
  guardClassAccess: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/signals/loadRosterSignals', () => ({
  loadRosterSignals: vi.fn(),
}));

// ── Import mocked modules to control their return values ──────────────────────
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { guardClassAccess } from '@/lib/auth/guards';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import type { RosterSignals } from '@/lib/signals/loadRosterSignals';

const mockLoadRosterSignals = vi.mocked(loadRosterSignals);
const mockGuardClassAccess = vi.mocked(guardClassAccess);
const mockFirstClass = vi.mocked(firstClassIdForTeacher);

// ── Fixture ───────────────────────────────────────────────────────────────────
// 5 roster items:
//   - 1 with band:null (not assessed) — "Hana Patel"
//   - 1 with band:'advanced' (Strong student) — "Gary Kim"
//   - 3 with band:'grade_level'
// focus_group: 3 items with severities 3, 2, 1 for sort order test
//   severity-3: "Carol High", severity-2: "Anna Mid", severity-1: "Alice Low"
// risk_scores use distinctive numbers (77, 83, 91, 79, 85) — not 0/50/100
const FIXTURE: RosterSignals = {
  class_id: 'c1',
  roster: [
    // in focus group — severity 3
    {
      student_id: 's1',
      full_name: 'Carol High',
      band: 'reteach',
      volatile: true,
      risk: { risk_score: 77, risk_level: 'critical', risk_factors: ['Low quiz average'] },
    },
    // in focus group — severity 2
    {
      student_id: 's2',
      full_name: 'Anna Mid',
      band: 'grade_level',
      volatile: false,
      risk: { risk_score: 83, risk_level: 'high', risk_factors: [] },
    },
    // in focus group — severity 1
    {
      student_id: 's3',
      full_name: 'Alice Low',
      band: 'grade_level',
      volatile: false,
      risk: { risk_score: 91, risk_level: 'medium', risk_factors: [] },
    },
    // not in focus group — advanced band
    {
      student_id: 's4',
      full_name: 'Gary Kim',
      band: 'advanced',
      volatile: false,
      risk: { risk_score: 79, risk_level: 'low', risk_factors: [] },
    },
    // not assessed
    {
      student_id: 's5',
      full_name: 'Hana Patel',
      band: null,
      volatile: false,
      risk: { risk_score: 85, risk_level: 'low', risk_factors: [] },
    },
  ],
  focus_group: [
    // severity 3 — reteach — Carol High
    {
      student_id: 's1',
      full_name: 'Carol High',
      diagnosis: {
        suggestedAction: 'reteach',
        severity: 3,
        diagnosis: 'Carol needs another pass at this concept.',
      },
      divergence_score: 40,
      hw_avg: 78,
      quiz_avg: 38,
    },
    // severity 2 — verbal_check — Anna Mid
    {
      student_id: 's2',
      full_name: 'Anna Mid',
      diagnosis: {
        suggestedAction: 'verbal_check',
        severity: 2,
        diagnosis: 'Anna has a homework-quiz gap.',
      },
      divergence_score: 25,
      hw_avg: 45,
      quiz_avg: 70,
    },
    // severity 1 — monitor — Alice Low
    {
      student_id: 's3',
      full_name: 'Alice Low',
      diagnosis: {
        suggestedAction: 'monitor',
        severity: 1,
        diagnosis: 'Alice is slipping slightly.',
      },
      divergence_score: 12,
      hw_avg: 80,
      quiz_avg: 68,
    },
  ],
  concept_gaps: [
    {
      question_index: 0,
      question_text: 'skill:fractions',
      skill_name: 'Adding fractions',
      pct_incorrect: 65,
    },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TodayPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadRosterSignals.mockResolvedValue(FIXTURE);
    mockGuardClassAccess.mockResolvedValue(null);
  });

  it('defaults to the teacher first class (redirects) when no class param is present', async () => {
    mockFirstClass.mockResolvedValue('c1');
    const { default: TodayPage } = await import('../page');
    await expect(TodayPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/today?class=c1');
  });

  it('renders a dignified no-classes state when the teacher owns no classes', async () => {
    mockFirstClass.mockResolvedValue(null);
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({}) }),
    );
    expect(container.innerHTML).toContain('No classes yet');
  });

  it('renders the correct needs count in the summary sentence', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    // focus_group.length === 3 — should appear in summary
    const html = container.innerHTML;
    expect(html).toContain('3');
    expect(html).toMatch(/need/i);
  });

  it('renders NeedsYouCard showing students in sortFocusGroup order (severity DESC)', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    const html = container.innerHTML;
    // severity-3 Carol High must appear BEFORE severity-2 Anna Mid BEFORE severity-1 Alice Low
    const carolPos = html.indexOf('Carol High');
    const annaPos = html.indexOf('Anna Mid');
    const alicePos = html.indexOf('Alice Low');
    expect(carolPos).toBeGreaterThanOrEqual(0);
    expect(annaPos).toBeGreaterThanOrEqual(0);
    expect(alicePos).toBeGreaterThanOrEqual(0);
    expect(carolPos).toBeLessThan(annaPos);
    expect(annaPos).toBeLessThan(alicePos);
  });

  it('WinsCard shows the advanced band student name', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    expect(container.innerHTML).toContain('Gary Kim');
  });

  it('WinsCard shows on-track count line', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    expect(container.innerHTML).toMatch(/on track or stronger/i);
  });

  it('QuickStartCard links include ?class= param', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    expect(container.innerHTML).toContain('?class=c1');
  });

  it('renders Today heading', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    expect(container.innerHTML).toContain('Today');
  });

  it('renders concept_gaps skill names from the roster data', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    expect(container.innerHTML).toContain('Adding fractions');
  });

  it('stays quiet on a good day: no concept-gaps card when there are no gaps', async () => {
    mockLoadRosterSignals.mockResolvedValueOnce({ ...FIXTURE, concept_gaps: [] });
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    expect(container.innerHTML).not.toContain('Worth revisiting together');
  });
});
