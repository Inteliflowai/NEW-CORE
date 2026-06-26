// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChallengeCard } from '../ChallengeCard';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';

const base: ChallengeRow = {
  studentId: 's1', studentName: 'Maya', assignmentId: 'a1', title: 'Photosynthesis',
  status: 'completed', transferScore: 88, contentQuality: 'engaged',
  rubric: { use_of_evidence: 2, reasoning_strategy: 3 }, completedAt: '2026-06-22T10:00:00Z',
  effortLabel: 'persistent', revisionCount: 2, teliHintCount: 1,
};

describe('ChallengeCard', () => {
  it('scored: shows transfer word+%, engagement, rubric, and the date', () => {
    render(<ChallengeCard row={base} onTip={vi.fn()} onHideTip={vi.fn()} />);
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    expect(screen.getByText(/strong/i)).toBeInTheDocument();
    expect(screen.getByText(/88%/)).toBeInTheDocument();
    expect(screen.getByText(/engaged deeply/i)).toBeInTheDocument();
    expect(screen.getByText(/Evidence 2\/4/)).toBeInTheDocument();
    expect(screen.getByText(/Submitted Jun 2[12]/)).toBeInTheDocument();
  });
  it('in-progress: shows "not submitted yet", no score', () => {
    render(<ChallengeCard row={{ ...base, status: 'in_progress', transferScore: null, contentQuality: null, rubric: null, completedAt: null }} onTip={vi.fn()} onHideTip={vi.fn()} />);
    expect(screen.getByText(/not submitted yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
  it('hover fires onTip with the tooltip lines', () => {
    const onTip = vi.fn();
    render(<ChallengeCard row={base} onTip={onTip} onHideTip={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByText('Photosynthesis'));
    expect(onTip).toHaveBeenCalledWith(expect.arrayContaining(['Photosynthesis']), expect.any(Number), expect.any(Number));
  });
  it('keyboard: focus fires onTip with lines and coordinates', () => {
    const onTip = vi.fn();
    render(<ChallengeCard row={base} onTip={onTip} onHideTip={vi.fn()} />);
    fireEvent.focus(screen.getByText('Photosynthesis'));
    expect(onTip).toHaveBeenCalledWith(expect.arrayContaining(['Photosynthesis']), expect.any(Number), expect.any(Number));
  });
  it('keyboard: Escape fires onHideTip', () => {
    const onHideTip = vi.fn();
    render(<ChallengeCard row={base} onTip={vi.fn()} onHideTip={onHideTip} />);
    fireEvent.keyDown(screen.getByText('Photosynthesis'), { key: 'Escape' });
    expect(onHideTip).toHaveBeenCalled();
  });
});
