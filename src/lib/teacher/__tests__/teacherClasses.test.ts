import { describe, it, expect } from 'vitest';
import { teacherClassOptions } from '@/lib/teacher/teacherClasses';

// Minimal chainable query stub mirroring the other loader tests.
function makeAdmin(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'order']) q[m] = chain;
  (q as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return { from: () => q } as unknown as Parameters<typeof teacherClassOptions>[0];
}

describe('teacherClassOptions', () => {
  it('maps classes to {id,label}, appending the period when present', async () => {
    const admin = makeAdmin([
      { id: 'c1', name: 'Biology', period: '3' },
      { id: 'c2', name: 'Homeroom', period: null },
    ]);
    const out = await teacherClassOptions(admin, 'teacher-1');
    expect(out).toEqual([
      { id: 'c1', label: 'Biology — Period 3' },
      { id: 'c2', label: 'Homeroom' },
    ]);
  });

  it('returns [] when the teacher has no classes', async () => {
    const admin = makeAdmin([]);
    expect(await teacherClassOptions(admin, 'teacher-1')).toEqual([]);
  });
});
