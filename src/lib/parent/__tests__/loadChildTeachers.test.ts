import { describe, it, expect } from 'vitest';
import { dedupeTeachers } from '@/lib/parent/loadChildTeachers';

describe('dedupeTeachers', () => {
  it('collapses one teacher across multiple classes and joins class labels', () => {
    const out = dedupeTeachers([
      { teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', className: 'English Literature' },
      { teacherId: 't2', name: 'Mr. Bell', email: 'b@x.edu', className: 'Math' },
      { teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', className: 'Reading Lab' },
    ]);
    expect(out).toEqual([
      { teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', classLabel: 'English Literature · Reading Lab' },
      { teacherId: 't2', name: 'Mr. Bell', email: 'b@x.edu', classLabel: 'Math' },
    ]);
  });
  it('does not duplicate a class label if it repeats', () => {
    const out = dedupeTeachers([
      { teacherId: 't1', name: 'A', email: 'a@x.edu', className: 'Math' },
      { teacherId: 't1', name: 'A', email: 'a@x.edu', className: 'Math' },
    ]);
    expect(out).toEqual([{ teacherId: 't1', name: 'A', email: 'a@x.edu', classLabel: 'Math' }]);
  });
  it('returns [] for no rows', () => {
    expect(dedupeTeachers([])).toEqual([]);
  });
});
