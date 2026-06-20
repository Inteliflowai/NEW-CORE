import { describe, it, expect, vi } from 'vitest';
import { loadStudentIdentity } from '../loadStudentIdentity';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeAdmin(row: unknown) {
  return {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: row, error: null }),
        }),
      }),
    })),
  } as unknown as SupabaseClient;
}

describe('loadStudentIdentity', () => {
  it('returns the student identity fields from users', async () => {
    const admin = makeAdmin({
      id: 'stu-1',
      full_name: 'Maria Chen',
      display_name: 'Mari',
      grade_level: '7',
    });
    const out = await loadStudentIdentity(admin, 'stu-1');
    expect(out).toEqual({
      id: 'stu-1',
      full_name: 'Maria Chen',
      display_name: 'Mari',
      grade_level: '7',
    });
  });

  it('returns null when the student row is missing', async () => {
    const admin = makeAdmin(null);
    const out = await loadStudentIdentity(admin, 'nope');
    expect(out).toBeNull();
  });
});
