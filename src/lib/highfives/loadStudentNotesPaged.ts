import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentHighFive } from './loadStudentHighFives';

export interface PagedNotes {
  notes: StudentHighFive[];
  totalCount: number;
}

export async function loadStudentNotesPaged(
  admin: SupabaseClient,
  studentId: string,
  page: number,
  pageSize: number,
): Promise<PagedNotes> {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count } = await admin
    .from('high_fives')
    .select('id, note_text, created_at', { count: 'exact' })
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .range(from, to);
  return {
    notes: ((data ?? []) as { id: string; note_text: string; created_at: string }[]).map(
      (r) => ({ id: r.id, note_text: r.note_text, created_at: r.created_at }),
    ),
    totalCount: count ?? 0,
  };
}
