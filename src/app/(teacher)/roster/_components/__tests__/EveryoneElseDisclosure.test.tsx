// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { EveryoneElseDisclosure } from '../EveryoneElseDisclosure';
import type { RosterItem } from '@/lib/signals/loadRosterSignals';

const CLASS_ID = 'cls-test';

const others: RosterItem[] = [
  {
    student_id: 'alice',
    full_name: 'Alice',
    band: 'grade_level',
    volatile: false,
    risk: { risk_score: 80, risk_level: 'high', risk_factors: [] },
  },
  {
    student_id: 'bob',
    full_name: 'Bob',
    band: 'reteach',
    volatile: false,
    risk: { risk_score: 10, risk_level: 'low', risk_factors: [] },
  },
];

describe('EveryoneElseDisclosure', () => {
  it('shows "Everyone else (2)" in summary before expand', () => {
    const { container } = render(
      <EveryoneElseDisclosure others={others} classId={CLASS_ID} />,
    );
    expect(container.innerHTML).toContain('Everyone else (2)');
  });

  it('shows both student names after clicking to expand', () => {
    const { container, getByText } = render(
      <EveryoneElseDisclosure others={others} classId={CLASS_ID} />,
    );
    const summary = getByText(/Everyone else/);
    fireEvent.click(summary);
    expect(container.innerHTML).toContain('Alice');
    expect(container.innerHTML).toContain('Bob');
  });

  it('renders a risk badge for the high-risk row (Alice)', () => {
    const { container, getByText } = render(
      <EveryoneElseDisclosure others={others} classId={CLASS_ID} />,
    );
    const summary = getByText(/Everyone else/);
    fireEvent.click(summary);
    // RiskBadge renders the band text for high risk
    expect(container.innerHTML).toContain('high');
  });

  it('does NOT render a risk badge text for the low-risk row (Bob)', () => {
    const { container, getByText } = render(
      <EveryoneElseDisclosure others={others} classId={CLASS_ID} />,
    );
    const summary = getByText(/Everyone else/);
    fireEvent.click(summary);
    // The word "low" should NOT appear (no risk badge for low risk)
    expect(container.innerHTML).not.toContain('>low<');
  });

  it('NEVER leaks risk_score (80) into the DOM', () => {
    const { container, getByText } = render(
      <EveryoneElseDisclosure others={others} classId={CLASS_ID} />,
    );
    const summary = getByText(/Everyone else/);
    fireEvent.click(summary);
    expect(container.innerHTML).not.toContain('80');
  });

  it('renders look-closer links with correct hrefs', () => {
    const { container, getByText } = render(
      <EveryoneElseDisclosure others={others} classId={CLASS_ID} />,
    );
    const summary = getByText(/Everyone else/);
    fireEvent.click(summary);
    const links = container.querySelectorAll('a');
    const hrefs = Array.from(links).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`/students/alice?from=roster&class=${CLASS_ID}`);
    expect(hrefs).toContain(`/students/bob?from=roster&class=${CLASS_ID}`);
  });
});
