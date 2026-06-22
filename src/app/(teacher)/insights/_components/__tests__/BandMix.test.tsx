// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BandMix } from '../BandMix';

describe('BandMix', () => {
  it('shows each band label with its count', () => {
    render(<BandMix mix={{ needs_reinforcement: 2, on_track: 5, ready_to_enrich: 1, not_assessed: 0, total: 8 }} />);
    expect(screen.getByText('Needs reinforcement')).toBeInTheDocument();
    expect(screen.getByText('On track')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
