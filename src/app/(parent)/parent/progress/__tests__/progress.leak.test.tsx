// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { hasDiagnosticVocab, hasLeak } from '@/lib/copy/leakGuard';
import { hasParentLeak } from '@/lib/copy/parentGuard';
import { loadParentProgress } from '@/lib/parent/loadParentProgress';

// Convention: page-level Server Component tests mock next/navigation so a deny-path
// redirect() is a controllable throw, not the opaque NEXT_REDIRECT (see student.leak.test).
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('REDIRECT'); }),
}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: 'p1' }),
}));
vi.mock('@/lib/auth/guards', () => ({
  guardStudentAccess: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/parent/loadParentChildren', () => ({
  loadParentChildren: vi.fn().mockResolvedValue([{ id: 's1', firstName: 'Alex' }]),
}));
vi.mock('@/lib/parent/loadParentProgress', () => ({
  loadParentProgress: vi.fn().mockResolvedValue({
    gradeDirection: 'climbing',
    points: [
      { date: '2026-05-01', grade: 0, label: '' },
      { date: '2026-05-08', grade: 0.5, label: '' },
      { date: '2026-05-15', grade: 1, label: '' },
    ],
    strengths: [
      { skillName: 'Fractions', label: 'Solid' },
      { skillName: 'Poetry', label: 'Excelling' },
    ],
    upcoming: [
      { id: 'a1', title: 'Persuasive Essay', dueLabel: 'Due tomorrow' },
      { id: 'a2', title: 'Vocabulary Practice', dueLabel: 'Due Friday' },
    ],
  }),
}));

import ParentProgressPage from '@/app/(parent)/parent/progress/page';

describe('ParentProgressPage — four-audience leak gate', () => {
  it('renders no diagnostic vocabulary anywhere on the surface', async () => {
    render(await ParentProgressPage({ searchParams: Promise.resolve({}) }));
    expect(hasDiagnosticVocab(document.body.textContent ?? '')).toBe(false);
  });

  it('renders no parent leak anywhere (digit-free fixtures)', async () => {
    render(await ParentProgressPage({ searchParams: Promise.resolve({}) }));
    expect(hasParentLeak(document.body.textContent ?? '')).toBe(false);
  });

  it('has no numeric leak in AUTHORED prose nodes (verbatim identifiers + sparkline aria-label excepted)', async () => {
    render(await ParentProgressPage({ searchParams: Promise.resolve({}) }));
    // Scan only prose we author. [data-verbatim] spans (assignment titles, skill
    // names) are content identifiers that may legitimately carry digits (Global
    // Constraints, "content identifiers verbatim") and are excluded; <li> aggregates
    // verbatim children so it is not scanned directly.
    const nodes = Array.from(
      document.querySelectorAll('p, h1, h2, span:not([data-verbatim])'),
    ).map((el) => el.textContent ?? '');
    for (const text of nodes) expect(hasLeak(text)).toBe(false);
  });

  it('shows the child name, a strength, and an upcoming item', async () => {
    render(await ParentProgressPage({ searchParams: Promise.resolve({}) }));
    const body = document.body.textContent ?? '';
    expect(body).toContain('Alex');
    expect(body).toContain('Fractions');
    expect(body).toContain('Persuasive Essay');
    expect(body).toContain('Due tomorrow');
  });

  it('renders a digit-bearing assignment title verbatim (content identifiers are not stripped)', async () => {
    vi.mocked(loadParentProgress).mockResolvedValueOnce({
      gradeDirection: 'steady',
      points: [{ date: 'a', grade: 0, label: '' }, { date: 'b', grade: 1, label: '' }],
      strengths: [],
      upcoming: [{ id: 'a9', title: 'Chapter 2 Essay', dueLabel: 'Due Friday' }],
    });
    render(await ParentProgressPage({ searchParams: Promise.resolve({}) }));
    // The digit-bearing title renders as-is (verbatim content identifier)…
    expect(document.body.textContent).toContain('Chapter 2 Essay');
    // …while authored prose (excluding verbatim spans) stays digit-free.
    const nodes = Array.from(
      document.querySelectorAll('p, h1, h2, span:not([data-verbatim])'),
    ).map((el) => el.textContent ?? '');
    for (const text of nodes) expect(hasLeak(text)).toBe(false);
  });
});
