// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChallengesList } from '../ChallengesList';
import type { StudentChallengeGroup } from '@/lib/spark/groupChallenges';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';

const ch = (o: Partial<ChallengeRow>): ChallengeRow => ({
  studentId: 's1', studentName: 'Maya', assignmentId: 'a1', title: 'Photosynthesis', status: 'completed',
  transferScore: 88, contentQuality: 'engaged', rubric: null, completedAt: '2026-06-22T10:00:00Z',
  effortLabel: null, revisionCount: null, teliHintCount: null, ...o,
});
const groups: StudentChallengeGroup[] = [{
  studentId: 's1', studentName: 'Maya Chen', summary: { scored: 1, inProgress: 1, notStarted: 0 },
  challenges: [ch({}), ch({ assignmentId: 'a2', title: 'Osmosis', status: 'in_progress', transferScore: null, completedAt: null })],
}];

describe('ChallengesList', () => {
  it('collapsed: shows the student + summary, hides challenges', () => {
    render(<ChallengesList groups={groups} />);
    expect(screen.getByText('Maya Chen')).toBeInTheDocument();
    expect(screen.getByText('1 scored · 1 in progress')).toBeInTheDocument();
    expect(screen.queryByText('Photosynthesis')).not.toBeInTheDocument();
  });
  it('expands on click to reveal the challenges', () => {
    render(<ChallengesList groups={groups} />);
    fireEvent.click(screen.getByRole('button', { name: /Maya Chen/ }));
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    expect(screen.getByText('Osmosis')).toBeInTheDocument();
  });
  it('hovering a challenge shows the tooltip', () => {
    render(<ChallengesList groups={groups} />);
    fireEvent.click(screen.getByRole('button', { name: /Maya Chen/ }));
    fireEvent.mouseEnter(screen.getByText('Photosynthesis'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Photosynthesis');
  });
});
