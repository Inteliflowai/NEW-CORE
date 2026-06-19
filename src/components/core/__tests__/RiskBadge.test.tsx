// @vitest-environment jsdom
// src/components/core/__tests__/RiskBadge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/test/setup-dom';
import { RiskBadge } from '../RiskBadge';

describe('RiskBadge — band label rendering', () => {
  it('renders "low" for score 10 (0to100)', () => {
    render(<RiskBadge score={10} />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('renders "medium" for score 30 (0to100)', () => {
    render(<RiskBadge score={30} />);
    expect(screen.getByText('medium')).toBeInTheDocument();
  });

  it('renders "high" for score 60 (0to100)', () => {
    render(<RiskBadge score={60} />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('renders "critical" for score 80 (0to100)', () => {
    render(<RiskBadge score={80} />);
    expect(screen.getByText('critical')).toBeInTheDocument();
  });

  it('renders "low" for score 0.1 (0to1 scale)', () => {
    render(<RiskBadge score={0.1} scale="0to1" />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('renders "critical" for score 0.9 (0to1 scale)', () => {
    render(<RiskBadge score={0.9} scale="0to1" />);
    expect(screen.getByText('critical')).toBeInTheDocument();
  });
});

describe('RiskBadge — NEVER renders the raw numeric score', () => {
  it('does not render the numeric score 10 in the DOM', () => {
    render(<RiskBadge score={10} />);
    expect(screen.queryByText('10')).not.toBeInTheDocument();
    expect(screen.queryByText(/\b10\b/)).not.toBeInTheDocument();
  });

  it('does not render the numeric score 80 in the DOM', () => {
    render(<RiskBadge score={80} />);
    expect(screen.queryByText('80')).not.toBeInTheDocument();
    expect(screen.queryByText(/\b80\b/)).not.toBeInTheDocument();
  });

  it('does not render 0.9 (0to1 score) in the DOM', () => {
    render(<RiskBadge score={0.9} scale="0to1" />);
    expect(screen.queryByText('0.9')).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.9/)).not.toBeInTheDocument();
  });

  it('container has no data-score attribute exposing the number', () => {
    const { container } = render(<RiskBadge score={42} />);
    expect(container.firstChild).not.toHaveAttribute('data-score');
  });
});

describe('RiskBadge — semantic role attribute', () => {
  it('has role="status" for screen readers', () => {
    render(<RiskBadge score={50} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('RiskBadge — band prop (pre-banded path)', () => {
  it('renders band directly when band prop given, no score needed', () => {
    render(<RiskBadge band="high" />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('band prop overrides score when both are provided', () => {
    render(<RiskBadge band="low" score={80} />);
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('does NOT render any numeric score in the DOM when only band prop given', () => {
    render(<RiskBadge band="high" />);
    expect(screen.queryByText(/\d+/)).not.toBeInTheDocument();
  });
});

describe('RiskBadge — tinted signal-pair token classes (WCAG AA readable)', () => {
  it('low band uses bg-ok-surface and text-ok-fg (not saturated bg-ok)', () => {
    const { container } = render(<RiskBadge score={10} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-ok-surface');
    expect(badge.className).toContain('text-ok-fg');
    expect(badge.className).not.toContain('text-fg-on-brand');
  });

  it('medium band uses bg-warn-surface and text-warn-fg', () => {
    const { container } = render(<RiskBadge score={30} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-warn-surface');
    expect(badge.className).toContain('text-warn-fg');
    expect(badge.className).not.toContain('text-fg-on-brand');
  });

  it('high band uses bg-risk-surface and text-risk-fg', () => {
    const { container } = render(<RiskBadge score={60} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-risk-surface');
    expect(badge.className).toContain('text-risk-fg');
    expect(badge.className).not.toContain('text-fg-on-brand');
  });

  it('critical band uses bg-risk-surface / text-risk-fg and adds ring-2 ring-risk for emphasis', () => {
    const { container } = render(<RiskBadge score={80} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-risk-surface');
    expect(badge.className).toContain('text-risk-fg');
    expect(badge.className).toContain('ring-2');
    expect(badge.className).toContain('ring-risk');
    expect(badge.className).not.toContain('text-fg-on-brand');
  });
});
