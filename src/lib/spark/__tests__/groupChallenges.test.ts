import { describe, it, expect } from 'vitest';
import { groupChallengesByStudent, studentSummaryLabel, shortDate, challengeTooltipLines } from '@/lib/spark/groupChallenges';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';

const base: Omit<ChallengeRow, 'assignmentId' | 'status' | 'completedAt'> = {
  studentId: 's1', studentName: 'Maya Chen', title: 'C', transferScore: null,
  contentQuality: null, rubric: null, effortLabel: null, revisionCount: null, teliHintCount: null,
};
const row = (o: Partial<ChallengeRow>): ChallengeRow =>
  ({ ...base, assignmentId: 'a', status: 'assigned', completedAt: null, ...o } as ChallengeRow);

describe('groupChallengesByStudent', () => {
  it('groups a student\'s challenges into one group', () => {
    const groups = groupChallengesByStudent([
      row({ studentId: 's1', studentName: 'Maya', assignmentId: 'a1', status: 'completed', completedAt: '2026-06-18T00:00:00Z' }),
      row({ studentId: 's1', studentName: 'Maya', assignmentId: 'a2', status: 'in_progress' }),
      row({ studentId: 's1', studentName: 'Maya', assignmentId: 'a3', status: 'completed', completedAt: '2026-06-22T00:00:00Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].summary).toEqual({ scored: 2, inProgress: 1, notStarted: 0 });
    // completed first, most-recent first; in_progress last
    expect(groups[0].challenges.map((c) => c.assignmentId)).toEqual(['a3', 'a1', 'a2']);
  });
  it('sorts students alphabetically', () => {
    const groups = groupChallengesByStudent([
      row({ studentId: 's2', studentName: 'Zoe', assignmentId: 'z1' }),
      row({ studentId: 's1', studentName: 'Abe', assignmentId: 'b1' }),
    ]);
    expect(groups.map((g) => g.studentName)).toEqual(['Abe', 'Zoe']);
  });
});

describe('studentSummaryLabel', () => {
  it('lists only non-zero states', () => {
    expect(studentSummaryLabel({ scored: 2, inProgress: 1, notStarted: 0 })).toBe('2 scored · 1 in progress');
    expect(studentSummaryLabel({ scored: 0, inProgress: 0, notStarted: 3 })).toBe('3 not started');
    expect(studentSummaryLabel({ scored: 0, inProgress: 0, notStarted: 0 })).toBe('No challenges yet');
  });
});

describe('shortDate + challengeTooltipLines', () => {
  it('formats a short date', () => {
    expect(shortDate('2026-06-22T10:00:00Z')).toMatch(/Jun 2[12]/); // tz-tolerant
    expect(shortDate(null)).toBe('');
  });
  it('tooltip: name + submitted date for scored, state otherwise', () => {
    expect(challengeTooltipLines(row({ title: 'Photosynthesis', status: 'completed', completedAt: '2026-06-22T10:00:00Z' }))[0]).toBe('Photosynthesis');
    expect(challengeTooltipLines(row({ status: 'completed', completedAt: '2026-06-22T10:00:00Z' }))[1]).toMatch(/^Submitted Jun 2[12]$/);
    expect(challengeTooltipLines(row({ status: 'in_progress' }))[1]).toBe('In progress — not submitted yet');
    expect(challengeTooltipLines(row({ status: 'assigned' }))[1]).toBe('Not started yet');
  });
});
