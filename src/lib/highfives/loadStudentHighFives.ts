import type { SupabaseClient } from '@supabase/supabase-js';

export interface StudentHighFive { id: string; note_text: string; created_at: string }

export async function loadStudentHighFives(admin: SupabaseClient, studentId: string, limit = 2): Promise<StudentHighFive[]> {
  const { data } = await admin.from('high_fives')
    .select('id, note_text, created_at, viewed_by_student_at')
    .eq('student_id', studentId).order('created_at', { ascending: false }).limit(limit);
  const rows = (data ?? []) as (StudentHighFive & { viewed_by_student_at: string | null })[];
  const unviewed = rows.filter((r) => r.viewed_by_student_at === null).map((r) => r.id);
  if (unviewed.length) {
    try { await admin.from('high_fives').update({ viewed_by_student_at: new Date().toISOString() }).in('id', unviewed); }
    catch { /* best-effort; never block the read */ }
  }
  return rows.map((r) => ({ id: r.id, note_text: r.note_text, created_at: r.created_at }));
}
