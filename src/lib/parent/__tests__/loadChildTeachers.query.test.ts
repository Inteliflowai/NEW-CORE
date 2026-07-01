import { describe, it, expect } from 'vitest';
import { makeFakeAdmin } from '@/test/fakeSupabase';
import { loadChildTeachers } from '@/lib/parent/loadChildTeachers';

describe('loadChildTeachers — IDOR scoping', () => {
  it('scopes enrollments by student_id + is_active, classes by id set, users by role=teacher', async () => {
    const admin = makeFakeAdmin({
      enrollments: { data: [{ class_id: 'c1' }, { class_id: 'c2' }] },
      classes: {
        data: [
          { id: 'c1', name: 'Eng 7', subject: 'English Literature', teacher_id: 't1' },
          { id: 'c2', name: 'Math 9', subject: 'Math', teacher_id: 't2' },
        ],
      },
      users: {
        data: [
          { id: 't1', email: 'w@x.edu', display_name: 'Ms. Whitfield', full_name: 'Dana Whitfield' },
          { id: 't2', email: 'b@x.edu', display_name: null, full_name: 'Marcus Bell' },
        ],
      },
    });
    const out = await loadChildTeachers(admin as never, 'stu-1');

    expect(admin.__used.enrollments.__calls).toContainEqual({ method: 'eq', args: ['student_id', 'stu-1'] });
    expect(admin.__used.enrollments.__calls).toContainEqual({ method: 'eq', args: ['is_active', true] });
    expect(admin.__used.classes.__calls).toContainEqual({ method: 'in', args: ['id', ['c1', 'c2']] });
    expect(admin.__used.users.__calls).toContainEqual({ method: 'eq', args: ['role', 'teacher'] });

    expect(out).toEqual([
      { teacherId: 't1', name: 'Ms. Whitfield', email: 'w@x.edu', classLabel: 'English Literature' },
      { teacherId: 't2', name: 'Marcus Bell', email: 'b@x.edu', classLabel: 'Math' },
    ]);
  });

  it('returns [] and never queries classes when the child has no active enrollments', async () => {
    const admin = makeFakeAdmin({ enrollments: { data: [] } });
    const out = await loadChildTeachers(admin as never, 'stu-1');
    expect(out).toEqual([]);
    expect(admin.__used.classes).toBeUndefined();
  });
});
