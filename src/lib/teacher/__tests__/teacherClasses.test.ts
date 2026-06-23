import { describe, it, expect } from 'vitest';
import { teacherClassOptions } from '@/lib/teacher/teacherClasses';

// Chainable query stub that RECORDS the table + eq() args, so the security-critical teacher_id
// scoping (the sole tenant-isolation guarantee on this RLS-bypassed admin client) is asserted.
function makeAdmin(rows: unknown[]) {
  const calls = { from: [] as string[], eq: [] as Array<[string, unknown]> };
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.order = () => q;
  q.eq = (col: string, val: unknown) => { calls.eq.push([col, val]); return q; };
  (q as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  const admin = { from: (t: string) => { calls.from.push(t); return q; } };
  return { admin: admin as unknown as Parameters<typeof teacherClassOptions>[0], calls };
}

describe('teacherClassOptions', () => {
  it('maps classes to {id,label}, appending the period when present', async () => {
    const { admin } = makeAdmin([
      { id: 'c1', name: 'Biology', period: '3' },
      { id: 'c2', name: 'Homeroom', period: null },
    ]);
    const out = await teacherClassOptions(admin, 'teacher-1');
    expect(out).toEqual([
      { id: 'c1', label: 'Biology — Period 3' },
      { id: 'c2', label: 'Homeroom' },
    ]);
  });

  it('scopes the query to classes WHERE teacher_id = the given teacher (tenant isolation)', async () => {
    const { admin, calls } = makeAdmin([]);
    await teacherClassOptions(admin, 'teacher-1');
    expect(calls.from).toContain('classes');
    expect(calls.eq).toContainEqual(['teacher_id', 'teacher-1']);
  });

  it('returns [] when the teacher has no classes', async () => {
    const { admin } = makeAdmin([]);
    expect(await teacherClassOptions(admin, 'teacher-1')).toEqual([]);
  });
});
