import { describe, it, expect } from 'vitest';
import { formatClassLabel, tallyActiveCounts, buildClassPayload } from '../route';

describe('classes route helpers', () => {
  it('formatClassLabel appends period when present', () => {
    expect(formatClassLabel({ name: 'Algebra', period: '3' })).toBe('Algebra — Period 3');
    expect(formatClassLabel({ name: 'Geo', period: null })).toBe('Geo');
  });

  it('tallyActiveCounts counts rows per class_id', () => {
    expect(tallyActiveCounts([{ class_id: 'a' }, { class_id: 'a' }, { class_id: 'b' }])).toEqual({ a: 2, b: 1 });
    expect(tallyActiveCounts([])).toEqual({});
  });

  it('buildClassPayload merges label/subject/count, defaulting a missing count to 0', () => {
    const classes = [
      { id: 'a', name: 'Algebra', period: '3', subject: 'Math' },
      { id: 'b', name: 'Geo', period: null, subject: null },
    ];
    expect(buildClassPayload(classes, { a: 8 })).toEqual([
      { class_id: 'a', label: 'Algebra — Period 3', subject: 'Math', student_count: 8 },
      { class_id: 'b', label: 'Geo', subject: null, student_count: 0 },
    ]);
  });
});
