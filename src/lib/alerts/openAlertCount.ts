import type { SupabaseClient } from '@supabase/supabase-js';

/** Count of DISTINCT students with an open URGENT alert across the teacher's classes (badge). */
export async function openAlertCountForTeacher(admin: SupabaseClient, teacherId: string): Promise<number> {
  const { data: classes } = await admin.from('classes').select('id').eq('teacher_id', teacherId);
  const ids = (classes ?? []).map((c: { id: string }) => c.id);
  if (ids.length === 0) return 0;
  const { data: rows } = await admin.from('alerts')
    .select('student_id').in('class_id', ids).eq('status', 'open').eq('severity', 'urgent');
  const distinct = new Set((rows ?? []).map((r: { student_id: string }) => r.student_id));
  return distinct.size;
}
