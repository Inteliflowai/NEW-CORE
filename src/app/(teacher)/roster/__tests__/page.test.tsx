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
  usePathname: () => '/roster',
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
// 8 roster items: 1 null-band, 3 in focus_group, 4 not in focus_group
const FIXTURE: RosterSignals = {
  class_id: 'c1',
  roster: [
    // focus group students
    {
      student_id: 's1',
      full_name: 'Anna Smith',
      band: 'reteach',
      volatile: false,
      risk: { risk_score: 55, risk_level: 'medium', risk_factors: [] },
    },
    {
      student_id: 's2',
      full_name: 'Bob Jones',
      band: 'grade_level',
      volatile: false,
      risk: { risk_score: 30, risk_level: 'medium', risk_factors: [] },
    },
    {
      student_id: 's3',
      full_name: 'Carol Lee',
      band: 'reteach',
      volatile: true,
      risk: { risk_score: 80, risk_level: 'critical', risk_factors: ['Low quiz average'] },
    },
    // non-focus-group students
    {
      student_id: 's4',
      full_name: 'Dana Park',
      band: 'grade_level',
      volatile: false,
      risk: { risk_score: 10, risk_level: 'low', risk_factors: [] },
    },
    {
      student_id: 's5',
      full_name: 'Evan Cho',
      band: 'advanced',
      volatile: false,
      risk: { risk_score: 5, risk_level: 'low', risk_factors: [] },
    },
    {
      student_id: 's6',
      full_name: 'Fay Wu',
      band: 'grade_level',
      volatile: false,
      risk: { risk_score: 15, risk_level: 'low', risk_factors: [] },
    },
    {
      student_id: 's7',
      full_name: 'Gary Kim',
      band: 'advanced',
      volatile: false,
      risk: { risk_score: 8, risk_level: 'low', risk_factors: [] },
    },
    // null band — not assessed
    {
      student_id: 's8',
      full_name: 'Hana Patel',
      band: null,
      volatile: false,
      risk: { risk_score: 20, risk_level: 'low', risk_factors: [] },
    },
  ],
  focus_group: [
    // s1: severity 2, verbal_check
    {
      student_id: 's1',
      full_name: 'Anna Smith',
      diagnosis: {
        suggestedAction: 'verbal_check',
        severity: 2,
        diagnosis: 'Anna has a homework-quiz gap.',
      },
      divergence_score: 25,
      hw_avg: 45,
      quiz_avg: 70,
    },
    // s2: severity 1, monitor — lowest priority
    {
      student_id: 's2',
      full_name: 'Bob Jones',
      diagnosis: {
        suggestedAction: 'monitor',
        severity: 1,
        diagnosis: 'Bob is slipping slightly.',
      },
      divergence_score: 22,
      hw_avg: 60,
      quiz_avg: 82,
    },
    // s3: severity 3, reteach — highest
    {
      student_id: 's3',
      full_name: 'Carol Lee',
      diagnosis: {
        suggestedAction: 'reteach',
        severity: 3,
        diagnosis: 'Carol needs another pass.',
      },
      divergence_score: 40,
      hw_avg: 78,
      quiz_avg: 38,
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

describe('RosterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadRosterSignals.mockResolvedValue(FIXTURE);
    mockGuardClassAccess.mockResolvedValue(null);
  });

  it('defaults to the teacher first class (redirects) when no class param is present', async () => {
    mockFirstClass.mockResolvedValue('c1');
    const { default: RosterPage } = await import('../page');
    await expect(RosterPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/roster?class=c1');
  });

  it('renders a dignified no-classes state when the teacher owns no classes', async () => {
    mockFirstClass.mockResolvedValue(null);
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({}) }),
    );
    expect(container.innerHTML).toContain('No classes yet');
  });

  it('renders the correct needs count (3) in the summary sentence', async () => {
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    // needs = 3 focus_group items; summary should have "3" and "need"
    const html = container.innerHTML;
    expect(html).toContain('3');
    expect(html).toMatch(/need/i);
  });

  it('renders the correct not-assessed phrasing in the summary', async () => {
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    // 1 not-assessed student (s8 has band:null)
    expect(container.innerHTML).toContain("hasn't been assessed");
  });

  it('renders focus cards in sortFocusGroup order: Carol (sev3) first, Anna (sev2), Bob (sev1) last', async () => {
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    const html = container.innerHTML;
    const carolPos = html.indexOf('Carol Lee');
    const annaPos = html.indexOf('Anna Smith');
    const bobPos = html.indexOf('Bob Jones');
    expect(carolPos).toBeGreaterThanOrEqual(0);
    expect(annaPos).toBeGreaterThanOrEqual(0);
    expect(bobPos).toBeGreaterThanOrEqual(0);
    expect(carolPos).toBeLessThan(annaPos);
    expect(annaPos).toBeLessThan(bobPos);
  });

  it('renders the concept gap skill_name', async () => {
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    expect(container.innerHTML).toContain('Adding fractions');
  });

  it('renders the Roster heading', async () => {
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({ class: 'c1' }) }),
    );
    expect(container.innerHTML).toContain('Roster');
  });
});
