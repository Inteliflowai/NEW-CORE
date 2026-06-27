// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ChapterTestTimer } from '../ChapterTestTimer';

/** Install a matchMedia stub on the jsdom window. */
function setupMatchMedia(prefersReduced = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: prefersReduced && q.includes('reduce'),
      media: q,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });
}

describe('ChapterTestTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows 44:00 when startedAt is exactly now (zero elapsed)', () => {
    const now = new Date().toISOString();
    render(<ChapterTestTimer startedAt={now} totalMinutes={44} onTimeUp={vi.fn()} />);
    expect(screen.getByRole('timer').textContent).toContain('44:00');
  });

  it('does NOT fire onTimeUp before totalMinutes have elapsed', () => {
    const onTimeUp = vi.fn();
    const now = new Date().toISOString();
    render(<ChapterTestTimer startedAt={now} totalMinutes={44} onTimeUp={onTimeUp} />);

    act(() => {
      // advance 43 minutes — 60 seconds remain, must not fire
      vi.advanceTimersByTime(43 * 60 * 1000);
    });

    expect(onTimeUp).not.toHaveBeenCalled();
  });

  it('fires onTimeUp exactly once when elapsed >= totalMinutes * 60 seconds', () => {
    const onTimeUp = vi.fn();
    const now = new Date().toISOString();
    render(<ChapterTestTimer startedAt={now} totalMinutes={44} onTimeUp={onTimeUp} />);

    act(() => {
      // advance past the full duration (+2 extra ticks to verify no double-fire)
      vi.advanceTimersByTime(44 * 60 * 1000 + 2000);
    });

    expect(onTimeUp).toHaveBeenCalledTimes(1);
  });

  it('shows --:-- when prefers-reduced-motion is active', () => {
    setupMatchMedia(true);
    const now = new Date().toISOString();
    render(<ChapterTestTimer startedAt={now} totalMinutes={44} onTimeUp={vi.fn()} />);
    expect(screen.getByRole('timer').textContent).toContain('--:--');
  });

  it('does NOT fire onTimeUp when prefers-reduced-motion (interval skipped)', () => {
    setupMatchMedia(true);
    const onTimeUp = vi.fn();
    const now = new Date().toISOString();
    render(<ChapterTestTimer startedAt={now} totalMinutes={44} onTimeUp={onTimeUp} />);

    act(() => {
      vi.advanceTimersByTime(44 * 60 * 1000 + 2000);
    });

    expect(onTimeUp).not.toHaveBeenCalled();
  });

  it('applies urgency (risk) styling when less than 5 minutes remain', () => {
    // Start 40 minutes in the past → 4 min remain (< 5-min threshold)
    const startedAt = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const { container } = render(
      <ChapterTestTimer startedAt={startedAt} totalMinutes={44} onTimeUp={vi.fn()} />,
    );
    expect(container.innerHTML).toContain('risk');
  });

  it('does NOT apply urgency styling when more than 5 minutes remain', () => {
    const now = new Date().toISOString();
    const { container } = render(
      <ChapterTestTimer startedAt={now} totalMinutes={44} onTimeUp={vi.fn()} />,
    );
    expect(container.innerHTML).not.toContain('risk');
  });
});
