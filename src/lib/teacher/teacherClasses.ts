// src/lib/teacher/teacherClasses.ts
// Server-side: the teacher's classes as {id,label} options for the library Class selector.
// Admin client (RLS-bypassed) is fine — the query is scoped to teacher_id, so it can only ever
// surface classes the teacher owns. Ordered by name for a stable dropdown order.
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatClassLabel } from '@/lib/teacher/classLabel';

export interface LibraryClassOption {
  id: string;
  label: string;
}

type ClassRow = { id: string; name: string | null; period: string | null };

export async function teacherClassOptions(
  admin: SupabaseClient,
  teacherId: string,
): Promise<LibraryClassOption[]> {
  const { data } = await admin
    .from('classes')
    .select('id, name, period')
    .eq('teacher_id', teacherId)
    .order('name', { ascending: true });
  return ((data ?? []) as ClassRow[]).map((c) => ({
    id: c.id,
    label: formatClassLabel({ name: c.name ?? 'Untitled class', period: c.period }),
  }));
}
