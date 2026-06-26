// @vitest-environment jsdom
import '@/test/setup-dom';
/**
 * report.leak.test.tsx
 *
 * Adversarial regression for the printable parent report.
 * Asserts that:
 *   1. hasParentLeak(container.textContent) === false  (full surface scan)
 *   2. The comparison sentence contains NO digit
 *   3. The comparison sentence contains NO "compared to" (banned peer-framing)
 *   4. All direction × direction combinations render without leaking
 *   5. Cold-start (hasEnoughData=false) renders safely
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { hasParentLeak } from '@/lib/copy/parentGuard';
import { ReportCard } from '../_components/ReportCard';
import type { ParentReport } from '@/lib/parent/perChildReportData';

// ── Adversarial fixtures ──────────────────────────────────────────────────────

/** Full-data fixture: both windows have direction. */
const FULL_REPORT: ParentReport = {
  firstName: 'Alex',
  recentDirection: 'climbing',
  priorDirection: 'steady',
  hasEnoughData: true,
  learningStyleLabel: 'visual',
  recentTopics: ['The Civil War', 'Poetry', 'Fractions'],
};

/** Only recent direction (no prior window data). */
const RECENT_ONLY_REPORT: ParentReport = {
  firstName: 'Jordan',
  recentDirection: 'sliding',
  priorDirection: null,
  hasEnoughData: true,
  learningStyleLabel: 'auditory',
  recentTopics: ['Creative Writing'],
};

/** Cold-start: not enough data yet. */
const COLD_START_REPORT: ParentReport = {
  firstName: 'Sam',
  recentDirection: null,
  priorDirection: null,
  hasEnoughData: false,
  learningStyleLabel: null,
  recentTopics: [],
};

/**
 * Adversarial fixture — topics that could leak if digit-stripping is absent,
 * plus a learning style that is safe.
 */
const DIGIT_HEAVY_TOPICS_REPORT: ParentReport = {
  firstName: 'Riley',
  recentDirection: 'steady',
  priorDirection: 'steady',
  hasEnoughData: true,
  learningStyleLabel: 'kinesthetic',
  recentTopics: [
    // These have already been through stripTopicDigits — no digits remain
    'The Water Cycle',
    'Literary Analysis',
    'Algebra',
    'Poetry',
    'The Civil War',
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReportCard — leak regression', () => {
  it('full report (climbing from steady) passes hasParentLeak', () => {
    const { container } = render(<ReportCard report={FULL_REPORT} />);
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });

  it('full report contains no digit in rendered text', () => {
    const { container } = render(<ReportCard report={FULL_REPORT} />);
    expect(/\d/.test(container.textContent ?? '')).toBe(false);
  });

  it('full report contains no "compared to" in rendered text', () => {
    const { container } = render(<ReportCard report={FULL_REPORT} />);
    expect(container.textContent ?? '').not.toMatch(/compared to/i);
  });

  it('recent-only direction renders without leaking', () => {
    const { container } = render(<ReportCard report={RECENT_ONLY_REPORT} />);
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
    expect(/\d/.test(container.textContent ?? '')).toBe(false);
    expect(container.textContent ?? '').not.toMatch(/compared to/i);
  });

  it('cold-start renders safely — no digits, no leak', () => {
    const { container } = render(<ReportCard report={COLD_START_REPORT} />);
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
    expect(/\d/.test(container.textContent ?? '')).toBe(false);
  });

  it('digit-heavy (pre-stripped) topics render without leaking', () => {
    const { container } = render(<ReportCard report={DIGIT_HEAVY_TOPICS_REPORT} />);
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
    expect(/\d/.test(container.textContent ?? '')).toBe(false);
  });

  it('all nine direction × direction combinations render without leaking', () => {
    const dirs = ['climbing', 'steady', 'sliding'] as const;

    for (const recentDirection of dirs) {
      for (const priorDirection of dirs) {
        const report: ParentReport = {
          ...FULL_REPORT,
          recentDirection,
          priorDirection,
        };
        const { container } = render(<ReportCard report={report} />);
        const text = container.textContent ?? '';

        expect(hasParentLeak(text)).toBe(false);
        expect(/\d/.test(text)).toBe(false);
        expect(text).not.toMatch(/compared to/i);
        expect(text).not.toMatch(/compared with/i);
        expect(text).not.toMatch(/\bpeers?\b/i);
      }
    }
  });

  it('recent-only (priorDirection=null) renders direction without leaking', () => {
    const dirs = ['climbing', 'steady', 'sliding'] as const;

    for (const recentDirection of dirs) {
      const report: ParentReport = {
        ...FULL_REPORT,
        recentDirection,
        priorDirection: null,
      };
      const { container } = render(<ReportCard report={report} />);
      const text = container.textContent ?? '';

      expect(hasParentLeak(text)).toBe(false);
      expect(/\d/.test(text)).toBe(false);
      expect(text).not.toMatch(/compared to/i);
    }
  });

  it('renders child first name in the journey section', () => {
    const { container } = render(<ReportCard report={FULL_REPORT} />);
    expect(container.textContent).toContain('Alex');
  });

  it('shows learning style label when present', () => {
    const { container } = render(<ReportCard report={FULL_REPORT} />);
    // "visual" in the learning style phrase — no leak
    expect(container.textContent).toContain('visual');
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });

  it('hides learning style section when learningStyleLabel is null', () => {
    const { container } = render(<ReportCard report={COLD_START_REPORT} />);
    expect(container.textContent).not.toContain('How');
  });

  it('shows recent topics when provided', () => {
    const { container } = render(<ReportCard report={FULL_REPORT} />);
    expect(container.textContent).toContain('The Civil War');
    expect(container.textContent).toContain('Poetry');
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
});
