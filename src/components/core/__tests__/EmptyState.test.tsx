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

  it('renders the correct role attribute for token targeting', () => {
    const { container } = render(<EmptyState variant="not-yet-assessed" />);
    expect(container.firstChild).toHaveClass('core-empty-state');
  });
});
