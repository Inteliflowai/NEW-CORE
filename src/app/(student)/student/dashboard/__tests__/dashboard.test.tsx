// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextUpCard } from '../_components/NextUpCard';

describe('NextUpCard', () => {
  it('renders assignment title and start link', () => {
    render(<NextUpCard id="a1" title="Essay on Romeo and Juliet" />);
    expect(screen.getByText('Essay on Romeo and Juliet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start/i })).toHaveAttribute(
      'href',
      '/student/assignments/a1',
    );
  });

  it('renders the "Next up" label', () => {
    render(<NextUpCard id="a2" title="Math Practice" />);
    expect(screen.getByText(/next up/i)).toBeInTheDocument();
  });
});
