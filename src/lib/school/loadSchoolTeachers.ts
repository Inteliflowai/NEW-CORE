// src/lib/school/loadSchoolTeachers.ts
// Pure loader for the school-admin Teachers page. Caller is responsible for auth
// (resolveAdminContext + createAdminSupabaseClient — RLS bypass via admin client;
// NEVER use with an authed user client). All queries are scoped to schoolId;
// cross-tenant safety is enforced by the explicit .eq('school_id', schoolId) on
// both the `users` and `classes` tables.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SchoolTeacher {
  id: string;
  name: string | null;
  email: string | null;
  lastActive: string | null;
  studentCount: number;
  classes: {
    id: string;
    name: string;
    subject: string | null;
    grade: string | null;
    enrollment: number;
  }[];
}

export async function loadSchoolTeachers(
  admin: SupabaseClient,
  schoolId: string,
): Promise<SchoolTeacher[]> {
  // ── 1. Fetch active teachers in this school ──────────────────────────────
  const { data: teacherRows } = await admin
    .from('users')
    .select('id, full_name, email, last_active_at')
    .eq('school_id', schoolId)
    .eq('role', 'teacher')
    .eq('is_active', true)
    .order('full_name');

  const teachers = (
    teacherRows as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
      last_active_at: string | null;
    }> | null
  ) ?? [];

  if (teachers.length === 0) return [];

  const teacherIds = teachers.map(t => t.id);

  // ── 2. Fetch active classes belonging to these teachers ──────────────────
  // school_id guard is the second cross-tenant lock: a rogue teacher_id from
  // another school cannot surface their classes here.
  const { data: classRows } = await admin
    .from('classes')
    .select('id, name, subject, grade_level, teacher_id')
    .eq('school_id', schoolId)
    .in('teacher_id', teacherIds)
    .eq('is_active', true);

  const classes = (
    classRows as Array<{
      id: string;
      name: string;
      subject: string | null;
      grade_level: string | null;
      teacher_id: string;
    }> | null
  ) ?? [];

  const classIds = classes.map(c => c.id);

  // ── 3. Fetch active enrollments for those classes ────────────────────────
  // We need the student_id so we can compute per-teacher DISTINCT student counts
  // in JS (a COUNT(*) per class would double-count students in multiple sections).
  let enrollments: Array<{ class_id: string; student_id: string }> = [];
  if (classIds.length > 0) {
    const { data: enrollRows } = await admin
      .from('enrollments')
      .select('class_id, student_id')
      .in('class_id', classIds)
      .eq('is_active', true);

    enrollments = (
      enrollRows as Array<{ class_id: string; student_id: string }> | null
    ) ?? [];
  }

  // ── Group enrollments by class_id (Set per class for O(1) lookup) ────────
  const studentsByClass = new Map<string, Set<string>>();
  for (const e of enrollments) {
    if (!studentsByClass.has(e.class_id)) {
      studentsByClass.set(e.class_id, new Set());
    }
    studentsByClass.get(e.class_id)!.add(e.student_id);
  }

  // ── Group classes by teacher_id ──────────────────────────────────────────
  type ClassRow = (typeof classes)[number];
  const classesByTeacher = new Map<string, ClassRow[]>();
  for (const cls of classes) {
    if (!classesByTeacher.has(cls.teacher_id)) {
      classesByTeacher.set(cls.teacher_id, []);
    }
    classesByTeacher.get(cls.teacher_id)!.push(cls);
  }

  // ── Compose result ───────────────────────────────────────────────────────
  return teachers.map(t => {
    const myClasses = classesByTeacher.get(t.id) ?? [];

    // Distinct students across ALL of this teacher's classes (Set deduplication)
    const distinctStudents = new Set<string>();
    for (const cls of myClasses) {
      for (const sid of studentsByClass.get(cls.id) ?? []) {
        distinctStudents.add(sid);
      }
    }

    return {
      id: t.id,
      name: t.full_name,
      email: t.email,
      lastActive: t.last_active_at,
      studentCount: distinctStudents.size,
      classes: myClasses.map(cls => ({
        id: cls.id,
        name: cls.name,
        subject: cls.subject,
        grade: cls.grade_level,
        enrollment: studentsByClass.get(cls.id)?.size ?? 0,
      })),
    };
  });
}
