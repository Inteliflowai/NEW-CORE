// src/lib/teacher/firstClassIdForTeacher.ts
// Resolves a teacher's default class server-side so class-scoped screens render
// content immediately instead of flashing a "pick a class" state before the
// client class-switcher writes ?class=. Ordered by name for a stable default.
//
// Admin client (RLS-bypassed) is fine here: the query is scoped to the caller's
// own teacher_id, so it can only ever surface classes the teacher owns.

import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function firstClassIdForTeacher(teacherId: string): Promise<string | null> {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('classes')
    .select('id, name')
    .eq('teacher_id', teacherId)
    .order('name', { ascending: true })
    .limit(1);
  return data && data.length > 0 ? (data[0] as { id: string }).id : null;
}
