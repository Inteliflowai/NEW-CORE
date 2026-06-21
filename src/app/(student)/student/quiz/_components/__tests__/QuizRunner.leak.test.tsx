// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Mock fetch to prevent real network calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/student/quiz',
}));

import { ResultScreen } from '../ResultScreen';
import { studentResultBundle } from '@/lib/quiz/studentResultBundle';

/**
 * Leak-audit test: renders the done and forfeit variants from bundles built by
 * the REAL server helper (studentResultBundle) for raw score fixtures that must
 * NEVER surface as a digit / % / raw band enum in the DOM (Option-D).
 *
 * This proves the full chain: a raw score_pct + DB band enum → server bundle →
 * rendered DOM, with no number or enum leaking. The bands are the REAL DB enum
 * values (reteach | grade_level | advanced) — there is no 'above_level'.
 */
describe('ResultScreen — leak audit (server bundle → DOM)', () => {
  const SCORE_FIXTURES = [
    { scorePct: 42, band: 'reteach',     label: 'tough' },
    { scorePct: 65, band: 'grade_level', label: 'effort' },
    { scorePct: 78, band: 'grade_level', label: 'strong' },
    { scorePct: 92, band: 'advanced',    label: 'celebrating' },
  ];

  for (const { scorePct, band, label } of SCORE_FIXTURES) {
    it(`LEAK: score ${scorePct} (${label}) does not appear in done screen DOM`, () => {
      const bundle = studentResultBundle({
        scorePct,
        masteryBand: band,
        tier: 'middle',
        firstName: 'Alex',
        attemptId: 'leak-test-att',
      });
      const { container } = render(
        <ResultScreen
          variant="done"
          scoreMessage={bundle.scoreMessage}
          masteryLabel={bundle.masteryLabel}
          needsStudyGuide={bundle.needsStudyGuide}
          reviewItems={[]}
          onBack={vi.fn()}
        />,
      );
      // No digit at all reaches the DOM, no %, and no raw band enum.
      expect(container.textContent).not.toMatch(/\d/);
      expect(container.textContent).not.toContain('%');
      expect(container.textContent).not.toContain(band); // raw enum never rendered
    });
  }

  it('LEAK: forfeit closure screen has no raw score', () => {
    const { container } = render(
      <ResultScreen variant="forfeit" forfeitReason="closure" onBack={vi.fn()} />,
    );
    expect(container.textContent).not.toContain('%');
    // No 2–3 digit numbers (score percentages)
    expect(container.textContent).not.toMatch(/\b\d{2,3}\b/);
  });

  it('LEAK: forfeit time_up screen has no raw score', () => {
    const { container } = render(
      <ResultScreen variant="forfeit" forfeitReason="time_up" onBack={vi.fn()} />,
    );
    expect(container.textContent).not.toContain('%');
    expect(container.textContent).not.toMatch(/\b\d{2,3}\b/);
  });

  it('LEAK: mastery band enum "reteach" is mapped to a soft word, never rendered raw', () => {
    const bundle = studentResultBundle({
      scorePct: 42,
      masteryBand: 'reteach',
      tier: 'middle',
      firstName: 'Sam',
      attemptId: 'leak-test-att-2',
    });
    expect(bundle.masteryLabel).toBe('Building'); // mapped server-side
    const { container } = render(
      <ResultScreen
        variant="done"
        scoreMessage={bundle.scoreMessage}
        masteryLabel={bundle.masteryLabel}
        needsStudyGuide={bundle.needsStudyGuide}
        reviewItems={[]}
        onBack={vi.fn()}
      />,
    );
    // "reteach" is the DB enum; only the soft label ("Building") may render.
    expect(container.textContent).not.toContain('reteach');
    expect(container.textContent).toContain('Building');
  });
});
