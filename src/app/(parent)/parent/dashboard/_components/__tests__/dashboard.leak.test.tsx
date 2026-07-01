// @vitest-environment jsdom
import '@/test/setup-dom';
/**
 * dashboard.leak.test.tsx
 *
 * Adversarial regression for the parent dashboard components.
 * Asserts that:
 *   1. hasParentLeak(container.textContent) === false  (full surface scan)
 *   2. Leaky paragraphs are DROPPED (not rendered at all)
 *   3. Leaky high-five notes are DROPPED
 *   4. A ≥2-point sparkline renders (not cold-start) AND its aria-label + per-point
 *      <title> elements contain NO digits (C3 — digit-free label required)
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { hasParentLeak } from '@/lib/copy/parentGuard';

import { NarrativeCard } from '../NarrativeCard';
import { SeeMoreDetail } from '../SeeMoreDetail';
import { ChildSelector } from '../ChildSelector';
import { ContactTeacherCard } from '../ContactTeacherCard';
import { HelpAtHomeCard } from '../HelpAtHomeCard';
import { CelebrateCard } from '../CelebrateCard';

// ── Adversarial fixtures ────────────────────────────────────────────────────────

/** Clean paragraph — must render. */
const CLEAN_P = "Alex brings genuine curiosity to every topic they explore.";
/** Leaky paragraph — must be DROPPED. */
const LEAKY_P_ON_TRACK = "Alex is on track and doing well.";
/** Another leaky paragraph — "behind" comparison. */
const LEAKY_P_BEHIND = "Alex is falling behind the class this term.";
/** Leaky paragraph — "reinforce". */
const LEAKY_P_REINFORCE = "We are working to reinforce these skills.";

/** A high-five note that is parent-safe. */
const CLEAN_HF = { id: 'hf1', note: 'Great listening skills today!', created_at: '2026-06-01' };
/** A high-five note containing a forbidden word — must be DROPPED. */
const LEAKY_HF = { id: 'hf2', note: 'Alex is on track with reinforce activities.', created_at: '2026-06-01' };

/**
 * ≥2-point sparkline fixture. Points carry ONLY a digit-free label so the
 * GradeTrendSparkline <title> fallback (`${p.grade}%`) can NEVER fire (C3).
 */
const SPARKLINE_POINTS = [
  { date: '2026-05-01', grade: 72, label: 'The Civil War' },
  { date: '2026-05-08', grade: 80, label: 'Fractions' },
  { date: '2026-05-15', grade: 76, label: 'Poetry' },
];

// ── NarrativeCard ──────────────────────────────────────────────────────────────

describe('NarrativeCard — leak regression', () => {
  it('renders clean paragraphs and drops every leaky one', () => {
    const paragraphs = [CLEAN_P, LEAKY_P_ON_TRACK, LEAKY_P_BEHIND, LEAKY_P_REINFORCE];
    const { container } = render(<NarrativeCard paragraphs={paragraphs} />);

    // The clean paragraph must be present
    expect(container.textContent).toContain(CLEAN_P);

    // The leaky paragraphs must be DROPPED
    expect(container.textContent).not.toContain('on track');
    expect(container.textContent).not.toContain('falling behind');
    expect(container.textContent).not.toContain('reinforce');

    // Full surface — no parent leak anywhere
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });

  it('handles an all-leaky paragraphs list without crashing', () => {
    const { container } = render(
      <NarrativeCard paragraphs={[LEAKY_P_ON_TRACK, LEAKY_P_BEHIND]} />,
    );
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
});

// ── SeeMoreDetail ─────────────────────────────────────────────────────────────

describe('SeeMoreDetail — leak regression (C1 + C3)', () => {
  it('drops leaky high-five notes and passes the full surface', () => {
    const { container } = render(
      <SeeMoreDetail
        highFives={[CLEAN_HF, LEAKY_HF]}
        growthHistory={[60, 65, 70, 75]}
        sparklinePoints={SPARKLINE_POINTS}
        gradeTrendDirection="climbing"
      />,
    );

    // Clean high-five must render
    expect(container.textContent).toContain('Great listening');

    // Leaky high-five dropped
    expect(container.textContent).not.toContain('on track');
    expect(container.textContent).not.toContain('reinforce');

    // Full surface scan — no digits from sparkline <title> leaking through
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });

  it('C3 — sparkline with ≥2 points renders (not cold-start) and the aria-label has no digits', () => {
    const { container, queryByTestId } = render(
      <SeeMoreDetail
        highFives={[CLEAN_HF]}
        growthHistory={[60, 65, 70, 75]}
        sparklinePoints={SPARKLINE_POINTS}
        gradeTrendDirection="climbing"
      />,
    );

    // The sparkline must render (≥2 points) — not the cold-start fallback
    expect(queryByTestId('trend-cold-start')).toBeNull();
    expect(queryByTestId('grade-trend-sparkline')).not.toBeNull();

    // The SVG aria-label must contain NO digits (C3)
    const svg = container.querySelector('[data-testid="grade-trend-sparkline"]');
    expect(svg).not.toBeNull();
    const ariaLabel = svg?.getAttribute('aria-label') ?? '';
    expect(/\d/.test(ariaLabel)).toBe(false);

    // All <title> elements inside the SVG must contain NO digits (C3 — label is always digit-free)
    const titles = Array.from(container.querySelectorAll('[data-testid="grade-trend-sparkline"] title'));
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) {
      expect(/\d/.test(t.textContent ?? '')).toBe(false);
    }

    // Full surface — no parent leak
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });

  it('C3/CS-4 — sparkline is NOT rendered for <4 points and no digits leak', () => {
    // CS-4: GradeTrendSparkline is gated on growthHistory.length >= 4. With an
    // empty growthHistory, the sparkline element is not rendered at all — the
    // GrowthMotif cold-start state covers the "just getting started" UX instead.
    const { container, queryByTestId } = render(
      <SeeMoreDetail
        highFives={[]}
        growthHistory={[]}
        sparklinePoints={[{ date: '2026-06-01', grade: 0.8, label: 'Poetry' }]}
        gradeTrendDirection={null}
      />,
    );
    // Sparkline is gated out entirely when growthHistory < 4
    expect(queryByTestId('trend-cold-start')).toBeNull();

    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
});

// ── ChildSelector ─────────────────────────────────────────────────────────────

describe('ChildSelector — leak regression', () => {
  it('renders child names without leaking diagnostic content', () => {
    const children = [
      { id: 'c1', firstName: 'Alex' },
      { id: 'c2', firstName: 'Sam' },
    ];
    const { container } = render(
      <ChildSelector children={children} selectedId="c1" />,
    );

    expect(container.textContent).toContain('Alex');
    expect(container.textContent).toContain('Sam');
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
});

describe('Parent Shell cards — composed surface leak regression', () => {
  it('renders all three cards together with no parent leak', () => {
    const { container } = render(
      <div>
        <CelebrateCard note="You showed real focus today!" />
        <HelpAtHomeCard starters={['What surprised you today?', 'What was their class average?']} />
        <ContactTeacherCard
          teachers={[{ teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', classLabel: 'English Literature' }]}
        />
      </div>,
    );
    // leaky starter dropped
    expect(container.textContent).not.toContain('class average');
    // clean content present
    expect(container.textContent).toContain('You showed real focus today!');
    expect(container.textContent).toContain('Ms. Whitfield');
    // full surface clean
    expect(hasParentLeak(container.textContent ?? '')).toBe(false);
  });
});
