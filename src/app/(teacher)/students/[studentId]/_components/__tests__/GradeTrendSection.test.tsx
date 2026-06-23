// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GradeTrendSection } from '../GradeTrendSection';
import { hasBannedWord } from '@/lib/copy/leakGuard';

describe('GradeTrendSection', () => {
  it('renders the sparkline + a heading when there are points', () => {
    const trend = { points: [{ date: 'd1', grade: 70, assignment_title: 'L', on_time: true }, { date: 'd2', grade: 90, assignment_title: 'L', on_time: true }], direction: 'climbing' as const, latest: 90, average: 80 };
    const { container } = render(<GradeTrendSection trend={trend} studentName="Ana" />);
    expect(screen.getByText(/grades over time/i)).toBeInTheDocument();
    expect(screen.getByTestId('grade-trend-sparkline')).toBeInTheDocument();
    // heading prose is banned-word-free
    expect(hasBannedWord(screen.getByText(/grades over time/i).textContent ?? '')).toBe(false);
    expect(container).toBeTruthy();
  });
  it('renders cold-start under 2 points', () => {
    const trend = { points: [{ date: 'd', grade: 80, assignment_title: 'L', on_time: true }], direction: null, latest: 80, average: 80 };
    render(<GradeTrendSection trend={trend} studentName="Ana" />);
    expect(screen.getByTestId('trend-cold-start')).toBeInTheDocument();
  });
});
