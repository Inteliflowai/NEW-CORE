import { describe, it, expect } from 'vitest';
import { buildTrialRows } from '@/lib/trial/buildTrialRows';
import { DEMO_STUDENTS } from '@/lib/demo/demoCast';

const IDS = { schoolId: 'sch-1', schoolIdShort: 'sch-1abc', teacherId: 't-1' };
const NOW = new Date('2026-06-20T00:00:00Z');

describe('buildTrialRows — assigned_at', () => {
  it('stamps every assignment def with an assigned_at', () => {
    const rows = buildTrialRows(DEMO_STUDENTS, IDS, NOW);
    expect(rows.assignments.length).toBeGreaterThan(0);
    for (const a of rows.assignments) {
      expect(typeof a.assigned_at).toBe('string');
      expect(a.assigned_at.length).toBeGreaterThan(0);
    }
  });

  it('gives the defs DISTINCT assigned-days so same-lesson columns will split', () => {
    const rows = buildTrialRows(DEMO_STUDENTS, IDS, NOW);
    const days = new Set(rows.assignments.map(a => a.assigned_at.slice(0, 10)));
    // Four assignment defs (a1..a4) → four distinct assigned-days.
    expect(days.size).toBe(rows.assignments.length);
  });
});
