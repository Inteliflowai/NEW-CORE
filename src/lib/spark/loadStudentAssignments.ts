// src/lib/spark/loadStudentAssignments.ts — the student's own assignments (caller passes the
// authenticated studentId; admin client + student_id filter is the ownership guard).
// No scores, rubric dims, or mastery values returned — four-audience compliance.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StudentAssignmentRow {
  id: string;
  title: string;
  sparkStatus: string;
}

export async function loadStudentAssignments(
  admin: SupabaseClient,
  studentId: string,
): Promise<StudentAssignmentRow[]> {
  const { data } = await admin
    .from('assignments')
    .select('id, content, spark_status')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    (data ?? []) as unknown as {
      id: string;
      content: { title?: string } | null;
      spark_status: string | null;
    }[]
  ).map((a) => ({
    id: a.id,
    title: a.content?.title ?? 'Assignment',
    sparkStatus: a.spark_status ?? 'none',
  }));
}
