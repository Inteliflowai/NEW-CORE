// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuizTimer } from '../QuizTimer';

describe('QuizTimer', () => {
  it('renders MM:SS format for a normal time (300s = 5:00)', () => {
    render(<QuizTimer timeLeft={300} totalSeconds={600} />);
    expect(screen.getByText('5:00')).toBeTruthy();
  });

  it('renders 10:00 at full time', () => {
    render(<QuizTimer timeLeft={600} totalSeconds={600} />);
    expect(screen.getByText('10:00')).toBeTruthy();
  });

  it('renders 0:00 at zero', () => {
    render(<QuizTimer timeLeft={0} totalSeconds={600} />);
    expect(screen.getByText('0:00')).toBeTruthy();
  });

  it('applies warning class at 180s', () => {
    const { container } = render(<QuizTimer timeLeft={180} totalSeconds={600} />);
    expect(container.innerHTML).toContain('warn');
  });

  it('applies danger class at 60s', () => {
    const { container } = render(<QuizTimer timeLeft={60} totalSeconds={600} />);
    expect(container.innerHTML).toContain('risk');
  });

  it('applies pulse class at 30s', () => {
    const { container } = render(<QuizTimer timeLeft={30} totalSeconds={600} />);
    expect(container.innerHTML).toContain('animate-pulse');
  });

  it('does NOT apply warning or danger class at 181s (normal zone)', () => {
    const { container } = render(<QuizTimer timeLeft={181} totalSeconds={600} />);
    expect(container.innerHTML).not.toContain('risk');
    expect(container.innerHTML).not.toContain('warn');
  });

  it('LEAK AUDIT: no raw seconds count or % renders', () => {
    const { container } = render(<QuizTimer timeLeft={300} totalSeconds={600} />);
    // 300 must not appear as a raw number — only MM:SS format is acceptable
    expect(container.textContent).not.toContain('300');
    expect(container.textContent).not.toContain('%');
  });
});
