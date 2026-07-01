// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  describe('"View student’s work" toggle', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('shows the toggle for a completed row', () => {
      render(<ChallengeCard row={base} onTip={vi.fn()} onHideTip={vi.fn()} />);
      expect(screen.getByRole('button', { name: /view student’s work/i })).toBeInTheDocument();
    });

    it('does not show the toggle for an assigned row', () => {
      render(<ChallengeCard row={{ ...base, status: 'assigned' }} onTip={vi.fn()} onHideTip={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /view student’s work/i })).toBeNull();
    });

    it('clicking the toggle fetches with THIS row’s assignmentId, never studentId', async () => {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
      render(<ChallengeCard row={base} onTip={vi.fn()} onHideTip={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /view student’s work/i }));
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      const calledUrl = String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(calledUrl).toContain(`assignmentId=${base.assignmentId}`);
      expect(calledUrl).not.toContain(`assignmentId=${base.studentId}`);
    });
  });
});
