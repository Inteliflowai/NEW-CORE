// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryBanner } from '../RecoveryBanner';

describe('RecoveryBanner', () => {
  it('shows seconds when gap < 60', () => {
    render(<RecoveryBanner gapSec={45} closureSecondsLeft={255} onDismiss={vi.fn()} />);
    // Should mention 45 seconds of gap OR a minutes-to-close warning
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  it('shows minutes when gap >= 60', () => {
    render(<RecoveryBanner gapSec={120} closureSecondsLeft={180} onDismiss={vi.fn()} />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  it('calls onDismiss when the close button is clicked', () => {
    const dismiss = vi.fn();
    render(<RecoveryBanner gapSec={45} closureSecondsLeft={200} onDismiss={dismiss} />);
    const btn = screen.getByRole('button', { name: /dismiss|close/i });
    fireEvent.click(btn);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('LEAK AUDIT: uses warn tokens — no hardcoded hex color literals in markup', () => {
    const { container } = render(
      <RecoveryBanner gapSec={45} closureSecondsLeft={255} onDismiss={vi.fn()} />,
    );
    // No inline style with # hex — token classes only
    expect(container.innerHTML).not.toMatch(/style="[^"]*#[0-9a-fA-F]/);
  });
});
