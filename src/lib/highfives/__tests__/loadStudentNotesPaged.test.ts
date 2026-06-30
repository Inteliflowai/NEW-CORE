import { describe, it, expect } from 'vitest';
import { loadStudentNotesPaged } from '../loadStudentNotesPaged';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeAdmin(data: unknown[], count: number): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            range: () => Promise.resolve({ data, count, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('loadStudentNotesPaged', () => {
  it('returns notes and totalCount', async () => {
    const rows = [
      { id: 'h1', note_text: 'Great work!', created_at: '2026-06-01T10:00:00Z' },
      { id: 'h2', note_text: 'Keep it up!', created_at: '2026-05-28T10:00:00Z' },
    ];
    const result = await loadStudentNotesPaged(makeAdmin(rows, 5), 'student-1', 1, 2);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0].note_text).toBe('Great work!');
    expect(result.totalCount).toBe(5);
  });

  it('returns empty notes when no data', async () => {
    const result = await loadStudentNotesPaged(makeAdmin([], 0), 'student-1', 1, 20);
    expect(result.notes).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });
});
