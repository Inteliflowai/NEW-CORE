// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// ── Mocks — all declared before imports ──────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/today',
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

// ── Import mocked modules ─────────────────────────────────────────────────────
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { guardClassAccess } from '@/lib/auth/guards';
import type { RosterSignals } from '@/lib/signals/loadRosterSignals';

const mockLoadRosterSignals = vi.mocked(loadRosterSignals);
const mockGuardClassAccess = vi.mocked(guardClassAccess);

// ── Leak fixture ──────────────────────────────────────────────────────────────
// risk_score: 88 — must NEVER appear in DOM
// question_text: 'skill:leak-test' — must NEVER appear in DOM
// diagnosis.diagnosis: 'Some raw diagnosis string 88.' — must NEVER appear in DOM
// "88" appears in the raw diagnosis string deliberately — to verify it's the diagnosis
// string being blocked, not a coincidental number match
const LEAK_FIXTURE: RosterSignals = {
  class_id: 'lk1',
  roster: [
    // focus group student — risk_score 88 must not leak
    {
      student_id: 'lk-s1',
      full_name: 'Leak Student Alpha',
      band: 'reteach',
      volatile: false,
      risk: { risk_score: 88, risk_level: 'high', risk_factors: ['High redo rate'] },
    },
    // non-focus student
    {
      student_id: 'lk-s2',
      full_name: 'Leak Student Beta',
      band: 'grade_level',
      volatile: false,
      risk: { risk_score: 22, risk_level: 'low', risk_factors: [] },
    },
  ],
  focus_group: [
    {
      student_id: 'lk-s1',
      full_name: 'Leak Student Alpha',
      diagnosis: {
        suggestedAction: 'reteach',
        severity: 3,
        // Raw diagnosis string that must NEVER be rendered — contains "88" deliberately
        diagnosis: 'Some raw diagnosis string 88.',
      },
      divergence_score: 30,
      hw_avg: 65,
      quiz_avg: 35,
    },
  ],
  concept_gaps: [
    {
      question_index: 0,
      // opaque skill_id — must NEVER appear in DOM
      question_text: 'skill:leak-test',
      skill_name: 'Fractions',
      pct_incorrect: 70,
    },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TodayPage — leak discipline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadRosterSignals.mockResolvedValue(LEAK_FIXTURE);
    mockGuardClassAccess.mockResolvedValue(null);
  });

  it('does NOT render risk_score 88 in the DOM', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'lk1' }) }),
    );
    expect(container.innerHTML).not.toContain('88');
  });

  it('does NOT render the opaque question_text', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'lk1' }) }),
    );
    expect(container.innerHTML).not.toContain('skill:leak-test');
  });

  it('does NOT render the raw diagnosis string', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'lk1' }) }),
    );
    expect(container.innerHTML).not.toContain('Some raw diagnosis string');
  });

  it('DOES render triageWhySentence output (teacher-OK numbers, "Assignment" not "Homework")', async () => {
    const { default: TodayPage } = await import('../page');
    const { container } = render(
      await TodayPage({ searchParams: Promise.resolve({ class: 'lk1' }) }),
    );
    const html = container.innerHTML;
    // triageWhySentence for reteach with quiz_avg=35 produces "Quiz average is 35%..."
    // which contains "assignment" (teacher-OK) and does not contain "homework" or "HW"
    expect(html.toLowerCase()).toContain('assignment');
    expect(html.toLowerCase()).not.toContain('homework');
    expect(html).not.toContain('HW');
  });
});
