// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/roster',
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

// ── Leak fixture — distinctive risk_score numbers + opaque question_text ──────
// risk_score values 73 and 91 must NEVER appear in the rendered DOM.
// question_text 'skill:secret' must NEVER appear in the rendered DOM.
const LEAK_FIXTURE: RosterSignals = {
  class_id: 'lk1',
  roster: [
    // focus group student: risk_score=73 (distinctive — must not leak)
    {
      student_id: 'lk-s1',
      full_name: 'Leak Student Alpha',
      band: 'reteach',
      volatile: false,
      risk: { risk_score: 73, risk_level: 'high', risk_factors: ['High redo rate'] },
    },
    // everyone-else student: risk_score=91 (distinctive — must not leak)
    {
      student_id: 'lk-s2',
      full_name: 'Leak Student Beta',
      band: 'grade_level',
      volatile: false,
      risk: { risk_score: 91, risk_level: 'critical', risk_factors: [] },
    },
  ],
  focus_group: [
    {
      student_id: 'lk-s1',
      full_name: 'Leak Student Alpha',
      diagnosis: {
        suggestedAction: 'reteach',
        severity: 3,
        diagnosis: 'Alpha needs another pass at this concept.',
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
      question_text: 'skill:secret',
      skill_name: 'Secret Skill Name',
      pct_incorrect: 75,
    },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Roster page — leak discipline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadRosterSignals.mockResolvedValue(LEAK_FIXTURE);
    mockGuardClassAccess.mockResolvedValue(null);
  });

  it('does NOT render risk_score=73 anywhere in the DOM', async () => {
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({ class: 'lk1' }) }),
    );
    expect(container.innerHTML).not.toContain('73');
  });

  it('does NOT render risk_score=91 anywhere in the DOM', async () => {
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({ class: 'lk1' }) }),
    );
    expect(container.innerHTML).not.toContain('91');
  });

  it('does NOT render the opaque question_text (skill:secret) anywhere in the DOM', async () => {
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({ class: 'lk1' }) }),
    );
    expect(container.innerHTML).not.toContain('skill:secret');
  });

  it('DOES contain a risk-level band word for a medium+ student', async () => {
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({ class: 'lk1' }) }),
    );
    // RiskBadge renders the band word "high" or "critical" — both present in fixture
    // We check for "high" (lk-s1 in focus group) or "critical" (lk-s2 in everyone else)
    const html = container.innerHTML;
    const hasHigh = html.includes('high');
    const hasCritical = html.includes('critical');
    expect(hasHigh || hasCritical).toBe(true);
  });

  it('DOES render the humanized why sentence (teacher-only numbers allowed), not the raw diagnose() string', async () => {
    const { default: RosterPage } = await import('../page');
    const { container } = render(
      await RosterPage({ searchParams: Promise.resolve({ class: 'lk1' }) }),
    );
    const html = container.innerHTML;
    // Card renders triageWhySentence (keeps teacher-facing quiz/divergence numbers) ...
    expect(html).toContain('Quiz average is 35%'); // lk-s1 reteach: quiz_avg 35
    expect(html.toLowerCase()).toContain('assignment');
    // ... NOT the raw diagnose() string.
    expect(html).not.toContain('Alpha needs another pass at this concept.');
  });
});
