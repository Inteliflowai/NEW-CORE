// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GradeTrendSparkline } from '../GradeTrendSparkline';

const PTS = [
  { date: '2026-06-05T00:00:00Z', grade: 60, label: 'Fractions · 60%' },
  { date: '2026-06-10T00:00:00Z', grade: 70 },
  { date: '2026-06-15T00:00:00Z', grade: 90 },
];

describe('GradeTrendSparkline', () => {
  it('renders an accessible SVG line with one path and a point per grade', () => {
    const { container } = render(<GradeTrendSparkline points={PTS} ariaLabel="Grades over time: climbing" />);
    const svg = screen.getByRole('img', { name: /grades over time/i });
    expect(svg).toBeInTheDocument();
    expect(container.querySelectorAll('path')).toHaveLength(1);     // the line
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(PTS.length); // per-point dots
  });

  it('shows a calm cold-start message under 2 points (never a fake trend)', () => {
    render(<GradeTrendSparkline points={[{ date: 'x', grade: 80 }]} ariaLabel="x" coldStartLabel="Not enough yet to show a trend." />);
    expect(screen.getByTestId('trend-cold-start')).toHaveTextContent(/not enough yet/i);
  });
});
