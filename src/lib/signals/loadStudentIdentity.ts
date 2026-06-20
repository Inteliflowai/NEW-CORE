// src/lib/signals/loadStudentIdentity.ts
//
// Fetches a student's identity row for the One-Student header. This is
// intentionally SEPARATE from loadStudentSignals — the signals payload never
// carries name/grade. Caller must run the auth + IDOR guard first.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface StudentIdentity {
  id: string;
  full_name: string;
  display_name: string | null;
  grade_level: string | null;
}

/**
 * Loads { id, full_name, display_name, grade_level } for a single student.
 * Returns null when the row is missing.
 *
 * @param admin     Admin Supabase client (RLS-bypassed). Auth/IDOR is the caller's job.
 * @param studentId UUID of the student.
 */
export async function loadStudentIdentity(
  admin: SupabaseClient,
  studentId: string,
): Promise<StudentIdentity | null> {
  const { data } = await admin
    .from('users')
    .select('id, full_name, display_name, grade_level')
    .eq('id', studentId)
    .single();

  if (!data) return null;
  const row = data as StudentIdentity;
  return {
    id: row.id,
    full_name: row.full_name,
    display_name: row.display_name ?? null,
    grade_level: row.grade_level ?? null,
  };
}
