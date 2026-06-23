// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoachObservationCard } from '../CoachObservationCard';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
});

describe('CoachObservationCard', () => {
  const coach = { eyebrow: 'Worth a look?', line: 'Leila has been quieter on the hard ones.', suggestion: 'A short check-in might help.', tone: 'warn' as const, state: 'watch' as const };

  it('renders the eyebrow, line, suggestion and keeps the #at-risk anchor', () => {
    const { container } = render(<CoachObservationCard coach={coach} />);
    expect(screen.getByText('Worth a look?')).toBeInTheDocument();
    expect(screen.getByText(/quieter on the hard ones/i)).toBeInTheDocument();
    expect(screen.getByText(/short check-in/i)).toBeInTheDocument();
    expect(container.querySelector('#at-risk')).not.toBeNull();
  });

  it('omits the suggestion paragraph when there is none', () => {
    render(<CoachObservationCard coach={{ ...coach, suggestion: null }} />);
    expect(screen.queryByText(/short check-in/i)).toBeNull();
  });
});
