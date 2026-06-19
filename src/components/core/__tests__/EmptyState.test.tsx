// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { EmptyState } from '../EmptyState';

afterEach(() => {
  cleanup();
});

describe('EmptyState', () => {
  it('not-yet-assessed: renders the "Not yet assessed" heading', () => {
    render(<EmptyState variant="not-yet-assessed" />);
    expect(screen.getByText('Not yet assessed')).toBeInTheDocument();
  });

  it('not-yet-assessed: renders descriptive body copy', () => {
    render(<EmptyState variant="not-yet-assessed" />);
    expect(
      screen.getByText(/data will appear once/i)
    ).toBeInTheDocument();
  });

  it('just-getting-started: renders "Just getting started" heading', () => {
    render(<EmptyState variant="just-getting-started" />);
    expect(screen.getByText('Just getting started')).toBeInTheDocument();
  });

  it('just-getting-started: renders descriptive body copy', () => {
    render(<EmptyState variant="just-getting-started" />);
    expect(
      screen.getByText(/more practice/i)
    ).toBeInTheDocument();
  });

  it('on-track: renders "You\'re on track" heading', () => {
    render(<EmptyState variant="on-track" />);
    expect(screen.getByText(/on track/i)).toBeInTheDocument();
  });

  it('on-track: renders encouraging body copy', () => {
    render(<EmptyState variant="on-track" />);
    expect(screen.getByText(/keep going/i)).toBeInTheDocument();
  });

  it('has bg-surface utility class for token-driven surface', () => {
    const { container } = render(<EmptyState variant="not-yet-assessed" />);
    expect(container.firstChild).toHaveClass('bg-surface');
  });

  it('has rounded utility class for token-driven radius', () => {
    const { container } = render(<EmptyState variant="not-yet-assessed" />);
    expect(container.firstChild).toHaveClass('rounded');
  });

  it('accepts an additional className', () => {
    const { container } = render(<EmptyState variant="not-yet-assessed" className="extra" />);
    expect(container.firstChild).toHaveClass('extra');
  });

  it('uses overrides and deep-ink body (text-fg, not text-fg-muted)', () => {
    const { container } = render(<EmptyState variant="on-track" titleOverride="Nothing flagged" bodyOverride="All clear here." />);
    expect(screen.getByText('Nothing flagged')).toBeInTheDocument();
    expect(container.querySelector('p')?.className).toContain('text-fg');
    expect(container.querySelector('p')?.className).not.toContain('text-fg-muted');
  });

  it('titleOverride replaces the default heading', () => {
    render(<EmptyState variant="not-yet-assessed" titleOverride="Custom Title" />);
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
    expect(screen.queryByText('Not yet assessed')).not.toBeInTheDocument();
  });

  it('bodyOverride replaces the default body', () => {
    render(<EmptyState variant="not-yet-assessed" bodyOverride="Custom body text." />);
    expect(screen.getByText('Custom body text.')).toBeInTheDocument();
    expect(screen.queryByText(/data will appear/i)).not.toBeInTheDocument();
  });

  it('body <p> always uses text-fg (not text-fg-muted)', () => {
    const { container } = render(<EmptyState variant="just-getting-started" />);
    const p = container.querySelector('p');
    expect(p?.className).toContain('text-fg');
    expect(p?.className).not.toContain('text-fg-muted');
  });
});
