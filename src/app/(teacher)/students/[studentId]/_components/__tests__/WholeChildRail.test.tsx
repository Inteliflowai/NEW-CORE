// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WholeChildRail } from '../WholeChildRail';
import type { StudentSignals } from '@/lib/signals/loadStudentSignals';
import type { CoachObservation } from '@/lib/copy/coachObservation';

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
const cta = { kind: 'open-assignments', label: 'Open Assignments' } as const;

describe('WholeChildRail — Worth a look? (coach_read)', () => {
  it('renders a watch observation with its suggestion', () => {
    render(<WholeChildRail signals={signalsWith({ state: 'watch', eyebrow: 'Worth a look', line: "Maya's been rushing lately.", suggestion: 'A quick check-in might help.', tone: 'risk' })} storyLine="x" cta={cta} />);
    expect(screen.getByText('Worth a look')).toBeInTheDocument();
    expect(screen.getByText("Maya's been rushing lately.")).toBeInTheDocument();
    expect(screen.getByText('A quick check-in might help.')).toBeInTheDocument();
  });

  it('renders a calm state without a suggestion and leaks no digit', () => {
    const { container } = render(<WholeChildRail signals={signalsWith({ state: 'calm', eyebrow: 'Settling in', line: "Maya's working at a steady pace right now.", suggestion: null, tone: 'ok' })} storyLine="x" cta={cta} />);
    expect(screen.getByText('Settling in')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });

  it('keeps the #at-risk anchor (priority CTA scroll target)', () => {
    const { container } = render(<WholeChildRail signals={signalsWith({ state: 'quiet', eyebrow: 'Still settling in', line: 'Still getting to know how Maya works.', suggestion: null, tone: 'ok' })} storyLine="x" cta={cta} />);
    expect(container.querySelector('#at-risk')).not.toBeNull();
  });
});
