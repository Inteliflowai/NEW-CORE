import { describe, it, expect } from 'vitest';
import { loadParentChildren } from '@/lib/parent/loadParentChildren';
import type { SupabaseClient } from '@supabase/supabase-js';

type Resolve = (v: { data: unknown[]; error: null }) => void;

function makeChain(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = chain;
  (q as { then: (r: Resolve) => void }).then = (resolve) => resolve({ data: rows, error: null });
  return q;
}

function makeAdmin(rows: unknown[]) {
  return {
    from(_table: string) {
      return makeChain(rows);
    },
  } as unknown as SupabaseClient;
}

describe('loadParentChildren', () => {
  it('returns mapped children for the given parent', async () => {
    const rows = [
      { id: 'stu1', full_name: 'Alex Morgan' },
      { id: 'stu2', full_name: 'Jordan Lee' },
    ];
    const result = await loadParentChildren(makeAdmin(rows), 'parent1');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'stu1', firstName: 'Alex' });
    expect(result[1]).toEqual({ id: 'stu2', firstName: 'Jordan' });
  });

  it('extracts only the first whitespace token as firstName', async () => {
    const rows = [{ id: 'stu3', full_name: 'Dana Whitfield Smith' }];
    const result = await loadParentChildren(makeAdmin(rows), 'parent1');
    expect(result[0].firstName).toBe('Dana');
  });

  it('falls back to "Student" when full_name is null', async () => {
    const rows = [{ id: 'stu4', full_name: null }];
    const result = await loadParentChildren(makeAdmin(rows), 'parent1');
    expect(result[0].firstName).toBe('Student');
  });

  it('returns empty array when the parent has no children', async () => {
    const result = await loadParentChildren(makeAdmin([]), 'parent1');
    expect(result).toEqual([]);
  });
});
