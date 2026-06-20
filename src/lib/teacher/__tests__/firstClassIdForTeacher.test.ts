import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the admin client as a thenable query builder chain:
// from('classes').select(...).eq(...).order(...).limit(1) → { data }
const order = vi.fn();
const limit = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const from = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({ from }),
}));

import { firstClassIdForTeacher } from '../firstClassIdForTeacher';

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue({ select });
  select.mockReturnValue({ eq });
  eq.mockReturnValue({ order });
  order.mockReturnValue({ limit });
});

describe('firstClassIdForTeacher', () => {
  it('returns the first class id and scopes the query to the teacher', async () => {
    limit.mockResolvedValue({ data: [{ id: 'c1', name: 'Algebra I' }] });
    expect(await firstClassIdForTeacher('t1')).toBe('c1');
    expect(from).toHaveBeenCalledWith('classes');
    expect(eq).toHaveBeenCalledWith('teacher_id', 't1');
    expect(order).toHaveBeenCalledWith('name', { ascending: true });
    expect(limit).toHaveBeenCalledWith(1);
  });

  it('returns null when the teacher owns no classes', async () => {
    limit.mockResolvedValue({ data: [] });
    expect(await firstClassIdForTeacher('t1')).toBeNull();
  });

  it('returns null when the query errors (data null)', async () => {
    limit.mockResolvedValue({ data: null });
    expect(await firstClassIdForTeacher('t1')).toBeNull();
  });
});
