// src/lib/school/loadSchoolClasses.ts
// Pure loader for the school-admin Classes & Roster page. Caller is responsible
// for auth (resolveAdminContext + createAdminSupabaseClient — RLS bypass via admin
// client; NEVER use with an authed user client). All queries are scoped to schoolId;
// cross-tenant safety is enforced by the explicit .eq('school_id', schoolId) on the
// `classes` table.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SchoolClass {
  id: string;
  name: string;
  subject: string | null;
  grade: string | null;
  teacherName: string | null;
  enrollment: number;
  googleSynced: boolean;
}

export async function loadSchoolClasses(
  admin: SupabaseClient,
  schoolId: string,
): Promise<SchoolClass[]> {
  // ── 1. Fetch active classes in this school ───────────────────────────────
  const { data: classRows } = await admin
    .from('classes')
    .select('id, name, subject, grade_level, teacher_id, google_course_id')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('name');

  const classes = (
    classRows as Array<{
      id: string;
      name: string;
      subject: string | null;
      grade_level: string | null;
      teacher_id: string | null;
      google_course_id: string | null;
    }> | null
  ) ?? [];

  if (classes.length === 0) return [];

  const classIds = classes.map(c => c.id);
  const teacherIds = [...new Set(classes.map(c => c.teacher_id).filter((id): id is string => id != null))];

  // ── 2. Fetch teacher names ────────────────────────────────────────────────
  // school_id guard is the second cross-tenant lock.
  let teacherMap = new Map<string, string | null>();
  if (teacherIds.length > 0) {
    const { data: teacherRows } = await admin
      .from('users')
      .select('id, full_name')
      .eq('school_id', schoolId)
      .in('id', teacherIds);

    const teachers = (
      teacherRows as Array<{ id: string; full_name: string | null }> | null
    ) ?? [];

    teacherMap = new Map(teachers.map(t => [t.id, t.full_name]));
  }

  // ── 3. Fetch active enrollment counts per class ───────────────────────────
  const { data: enrollRows } = await admin
    .from('enrollments')
    .select('class_id')
    .in('class_id', classIds)
    .eq('is_active', true);

  const enrollments = (
    enrollRows as Array<{ class_id: string }> | null
  ) ?? [];

  const enrollmentCount = new Map<string, number>();
  for (const e of enrollments) {
    enrollmentCount.set(e.class_id, (enrollmentCount.get(e.class_id) ?? 0) + 1);
  }

  // ── Compose result ────────────────────────────────────────────────────────
  return classes.map(cls => ({
    id: cls.id,
    name: cls.name,
    subject: cls.subject,
    grade: cls.grade_level,
    teacherName: cls.teacher_id != null ? (teacherMap.get(cls.teacher_id) ?? null) : null,
    enrollment: enrollmentCount.get(cls.id) ?? 0,
    googleSynced: cls.google_course_id != null && cls.google_course_id !== '',
  }));
}
