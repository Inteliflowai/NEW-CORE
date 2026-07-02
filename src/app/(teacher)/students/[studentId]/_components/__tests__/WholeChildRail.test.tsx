// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WholeChildRail } from '../WholeChildRail';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';
import type { StudentSignals } from '@/lib/signals/loadStudentSignals';
import type { CoachObservation } from '@/lib/copy/coachObservation';

// CoachObservationCard (the client island for the "Worth a look?" block) calls
// useReducedMotion() which needs matchMedia. Force it to report reduced-motion so
// framer-motion snaps to end state instantly in jsdom (same pattern as other tests).
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
});

/** Spec-promised DOM audit: no number and no banned word may reach the teacher DOM. */
function expectCleanDom(text: string) {
  expect(hasLeak(text)).toBe(false);
  expect(hasBannedWord(text)).toBe(false);
}

function signalsWith(coach_read: CoachObservation): StudentSignals {
  return {
    student_id: 'stu-1', current_band: 'grade_level',
    per_skill_cl: [], recurring_misconceptions: [],
    divergence: { divergence_score: 0, divergence_direction: 'aligned', divergence_trend: null, hw_avg: null, quiz_avg: null, divergence_flagged: false } as StudentSignals['divergence'],
    effort: { dominant_effort_pattern: null },
    risk: { roster: { risk_score: 0, risk_level: 'low', risk_factors: [] }, session: { score: 0, factors: [] } },
    reteach_outcomes: [], trajectory: { consistency_score: 0, consistency_label: 'consistent', trajectory: 'stable' } as StudentSignals['trajectory'],
    growth_history: [], coach_read,
  };
}
const cta = { kind: 'open-assignments', label: 'Open Assignments', anchor: '/gradebook' } as const;

describe('WholeChildRail — Worth a look? (coach_read)', () => {
  it('renders a watch observation with its suggestion (no number/banned word in DOM)', () => {
    const { container } = render(<WholeChildRail signals={signalsWith({ state: 'watch', eyebrow: 'Worth a look', line: "Maya's been rushing lately.", suggestion: 'A quick check-in might help.', tone: 'risk' })} storyLine="x" cta={cta} />);
    expect(screen.getByText('Worth a look')).toBeInTheDocument();
    expect(screen.getByText("Maya's been rushing lately.")).toBeInTheDocument();
    expect(screen.getByText('A quick check-in might help.')).toBeInTheDocument();
    expectCleanDom(container.textContent ?? '');
  });

  it('renders a calm state without a suggestion (no number/banned word in DOM)', () => {
    const { container } = render(<WholeChildRail signals={signalsWith({ state: 'calm', eyebrow: 'Settling in', line: "Maya's working at a steady pace right now.", suggestion: null, tone: 'ok' })} storyLine="x" cta={cta} />);
    expect(screen.getByText('Settling in')).toBeInTheDocument();
    expectCleanDom(container.textContent ?? '');
  });

  it('keeps the #at-risk anchor (priority CTA scroll target) and stays leak-clean when quiet', () => {
    const { container } = render(<WholeChildRail signals={signalsWith({ state: 'quiet', eyebrow: 'Still settling in', line: 'Still getting to know how Maya works.', suggestion: null, tone: 'ok' })} storyLine="x" cta={cta} />);
    expect(container.querySelector('#at-risk')).not.toBeNull();
    expectCleanDom(container.textContent ?? '');
  });

  it('renders the open-assignments priority CTA as a real link to /gradebook (no more "Coming soon" span)', () => {
    const { container } = render(<WholeChildRail signals={signalsWith({ state: 'quiet', eyebrow: 'Still settling in', line: 'Still getting to know how Maya works.', suggestion: null, tone: 'ok' })} storyLine="x" cta={cta} />);
    const link = screen.getByRole('link', { name: /open assignments/i });
    expect(link).toHaveAttribute('href', '/gradebook');
    expect(container.querySelector('[title="Coming soon"]')).toBeNull();
  });

  it('passes evidenceHref through to the Worth-a-look card', () => {
    render(<WholeChildRail signals={signalsWith({ state: 'watch', eyebrow: 'Worth a look', line: "Maya's been rushing lately.", suggestion: 'A quick check-in might help.', tone: 'risk' })} storyLine="x" cta={cta} evidenceHref="#quiz-detail" />);
    const link = screen.getByRole('link', { name: /see what's behind this/i });
    expect(link).toHaveAttribute('href', '#quiz-detail');
  });

  it('omits the evidence link on the rail when evidenceHref is not provided', () => {
    render(<WholeChildRail signals={signalsWith({ state: 'watch', eyebrow: 'Worth a look', line: "Maya's been rushing lately.", suggestion: 'A quick check-in might help.', tone: 'risk' })} storyLine="x" cta={cta} />);
    expect(screen.queryByText(/see what's behind this/i)).toBeNull();
  });
});
