// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import BackgroundRotator from '../BackgroundRotator';

afterEach(() => vi.useRealTimers());

describe('BackgroundRotator', () => {
  it('renders the first caption active on mount', () => {
    render(<BackgroundRotator />);
    expect(screen.getByText('Where curiosity catches fire.')).toBeInTheDocument();
  });

  it('renders five navigation dots', () => {
    render(<BackgroundRotator />);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });

  it('advances the active caption after the interval', () => {
    vi.useFakeTimers();
    render(<BackgroundRotator />);
    act(() => { vi.advanceTimersByTime(7000); });
    const active = screen.getByRole('tab', { selected: true });
    expect(active).toHaveAttribute('aria-label', expect.stringContaining('2'));
  });

  it('clears the pending timer on cleanup (no stacked timers)', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<BackgroundRotator />);
    act(() => { vi.advanceTimersByTime(7000); }); // effect re-runs → clears prior timer
    unmount();                                      // cleanup → clears current timer
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('jumps to a slide when its dot is clicked', () => {
    vi.useFakeTimers();
    render(<BackgroundRotator />);
    const dots = screen.getAllByRole('tab');
    act(() => { dots[3].click(); });
    expect(dots[3]).toHaveAttribute('aria-selected', 'true');
  });
});
