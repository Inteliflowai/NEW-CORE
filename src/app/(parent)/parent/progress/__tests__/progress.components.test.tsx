// @vitest-environment jsdom
import '@/test/setup-dom';
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TrendCard } from '../_components/TrendCard';
import { UpcomingCard } from '../_components/UpcomingCard';
import { StrengthsCard } from '../_components/StrengthsCard';

describe('TrendCard — quiet-when-empty', () => {
  it('suppresses the lead sentence when direction is null, but renders the sparkline (2 points)', () => {
    const { container, queryByTestId } = render(
      <TrendCard
        direction={null}
        points={[
          { date: 'a', grade: 0, label: '' },
          { date: 'b', grade: 1, label: '' },
        ]}
      />,
    );
    // direction===null gates the lead sentence off
    expect(container.textContent).not.toContain('momentum');
    // 2 points satisfies MIN_POINTS → the SVG sparkline renders
    expect(queryByTestId('grade-trend-sparkline')).not.toBeNull();
  });

  it('shows the cold-start placeholder and no lead sentence when points is empty', () => {
    const { container, queryByTestId } = render(
      <TrendCard direction={null} points={[]} />,
    );
    // direction===null → lead sentence absent
    expect(container.textContent).not.toContain('momentum');
    // 0 points < MIN_POINTS → cold-start fires
    expect(queryByTestId('trend-cold-start')).not.toBeNull();
  });
});

describe('UpcomingCard — quiet-when-empty', () => {
  it('shows the empty-state message when items is empty', () => {
    const { container } = render(<UpcomingCard items={[]} />);
    expect(container.textContent).toContain('No assignments coming up right now');
  });
});

describe('StrengthsCard — quiet-when-empty', () => {
  it('renders null (nothing in the DOM) when strengths is empty', () => {
    const { container } = render(
      <StrengthsCard firstName="Alex" strengths={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the skill name and label when a Solid strength is provided', () => {
    const { container } = render(
      <StrengthsCard
        firstName="Alex"
        strengths={[{ skillName: 'Fractions', label: 'Solid' }]}
      />,
    );
    expect(container.textContent).toContain('Fractions');
    expect(container.textContent).toContain('Solid');
  });
});
