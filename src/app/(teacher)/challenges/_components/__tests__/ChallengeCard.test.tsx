// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/test/setup-dom';
import { ChallengeCard } from '../ChallengeCard';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';

const base: ChallengeRow = {
  studentId: 's1', studentName: 'Alex', assignmentId: 'a1', title: 'Ecosystems',
  status: 'completed', transferScore: 88, contentQuality: 'engaged', rubric: null,
};

describe('ChallengeCard', () => {
  it('shows transfer word + % when completed', () => {
    render(<ChallengeCard row={base} />);
    expect(screen.getByText(/strong/i)).toBeInTheDocument();
    expect(screen.getByText(/88%/)).toBeInTheDocument();
  });

  it('shows the status label when not yet completed', () => {
    render(<ChallengeCard row={{ ...base, status: 'assigned', transferScore: null, contentQuality: null }} />);
    expect(screen.getByText('Assigned')).toBeInTheDocument();
  });

  it('uses "Challenge"/"Assignment" terminology, never "Homework"', () => {
    const { container } = render(<ChallengeCard row={base} />);
    expect(container.textContent?.toLowerCase()).not.toContain('homework');
  });
});
