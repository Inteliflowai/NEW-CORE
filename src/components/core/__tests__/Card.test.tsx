// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Card, StatCard } from '../Card';

afterEach(() => {
  cleanup();
});

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Hello card</Card>);
    expect(screen.getByText('Hello card')).toBeInTheDocument();
  });

  it('has the core-card class for CSS token targeting', () => {
    const { container } = render(<Card>content</Card>);
    expect(container.firstChild).toHaveClass('core-card');
  });

  it('accepts an additional className', () => {
    const { container } = render(<Card className="extra-class">x</Card>);
    expect(container.firstChild).toHaveClass('extra-class');
  });

  it('renders as a <div> by default', () => {
    const { container } = render(<Card>x</Card>);
    expect(container.firstChild?.nodeName).toBe('DIV');
  });
});

describe('StatCard', () => {
  it('renders the label', () => {
    render(<StatCard label="Score" value="94" />);
    expect(screen.getByText('Score')).toBeInTheDocument();
  });

  it('renders the value', () => {
    render(<StatCard label="Score" value="94" />);
    expect(screen.getByText('94')).toBeInTheDocument();
  });

  it('accepts a ReactNode value', () => {
    render(<StatCard label="Status" value={<span data-testid="val-node">On Track</span>} />);
    expect(screen.getByTestId('val-node')).toBeInTheDocument();
  });

  it('has the core-card class', () => {
    const { container } = render(<StatCard label="L" value="V" />);
    expect(container.firstChild).toHaveClass('core-card');
  });
});
