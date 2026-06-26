// src/lib/school/loadClassRoster.ts
// Pure loader for the roster of a single class. Caller is responsible for auth
// (resolveAdminContext + createAdminSupabaseClient — RLS bypass via admin client;
// NEVER use with an authed user client).
//
// IDOR guard: verifies the class belongs to the given school BEFORE fetching
// enrollment data. Returns null if the class isn't in this school.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClassRosterStudent {
  id: string;
  name: string | null;
  email: string | null;
  active: boolean;
  source: string | null;
}

export async function loadClassRoster(
  admin: SupabaseClient,
  classId: string,
  schoolId: string,
): Promise<{ students: ClassRosterStudent[] } | null> {
  // ── 1. IDOR guard: verify the class belongs to this school ────────────────
  const { data: classCheck } = await admin
    .from('classes')
    .select('id')
    .eq('id', classId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (!classCheck) return null;

  // ── 2. Fetch enrollments for this class ───────────────────────────────────
  const { data: enrollRows } = await admin
    .from('enrollments')
    .select('student_id, is_active, source')
    .eq('class_id', classId);

  const enrollments = (
    enrollRows as Array<{
      student_id: string;
      is_active: boolean;
      source: string | null;
    }> | null
  ) ?? [];

  if (enrollments.length === 0) return { students: [] };

  const studentIds = enrollments.map(e => e.student_id);

  // ── 3. Fetch student user records for name/email ──────────────────────────
  const { data: userRows } = await admin
    .from('users')
    .select('id, full_name, email')
    .in('id', studentIds);

  const users = (
    userRows as Array<{ id: string; full_name: string | null; email: string | null }> | null
  ) ?? [];

  const userMap = new Map(users.map(u => [u.id, u]));

  // ── Compose result ────────────────────────────────────────────────────────
  const students: ClassRosterStudent[] = enrollments.map(e => {
    const user = userMap.get(e.student_id);
    return {
      id: e.student_id,
      name: user?.full_name ?? null,
      email: user?.email ?? null,
      active: e.is_active,
      source: e.source,
    };
  });

  // Sort: active first, then by name
  students.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  return { students };
}
