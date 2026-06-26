// src/lib/school/loadSchoolReport.ts
// Pure operational-report loader for the school-admin surface.  Caller is
// responsible for auth (resolveAdminContext + createAdminSupabaseClient — RLS
// bypass via admin client; NEVER use with an authed user client).
//
// Cross-tenant safety:
//   1. Classes are fetched with .eq('school_id', schoolId) — the anchor.
//   2. Assignment counts use .in('class_id', classIds) — never a raw schoolId.
//   3. Attempt counts use .in('assignment_id', assignmentIds) — never a raw schoolId.
//   Teacher names are confirmed same-school via .eq('school_id', schoolId).
//
// NO per-student rows leave this loader.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SchoolReportClass {
  classId: string;
  className: string;
  teacherName: string | null;
  enrolledStudents: number;
  assignmentsCreated: number;
  assignmentsSubmitted: number;
  quizzesPublished: number;
}

export interface SchoolReport {
  schoolName: string;
  totalStudents: number;
  totalTeachers: number;
  totalClasses: number;
  totalAssignmentsSubmitted: number;
  totalQuizzesPublished: number;
  classes: SchoolReportClass[];
}

export async function loadSchoolReport(
  admin: SupabaseClient,
  schoolId: string,
): Promise<SchoolReport> {
  // ── 1. School name ────────────────────────────────────────────────────────
  const { data: schoolRow } = await admin
    .from('schools')
    .select('name')
    .eq('id', schoolId)
    .single();

  // ── 2. Active student + teacher head-counts ───────────────────────────────
  const { count: studentCount } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('role', 'student')
    .eq('is_active', true);

  const { count: teacherCount } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('role', 'teacher')
    .eq('is_active', true);

  // ── 3. Active classes scoped to this school (cross-tenant anchor) ─────────
  const { data: classRows } = await admin
    .from('classes')
    .select('id, name, teacher_id')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('name');

  const classes = (
    classRows as Array<{ id: string; name: string; teacher_id: string | null }> | null
  ) ?? [];

  if (classes.length === 0) {
    return {
      schoolName: (schoolRow as { name: string } | null)?.name ?? '',
      totalStudents: studentCount ?? 0,
      totalTeachers: teacherCount ?? 0,
      totalClasses: 0,
      totalAssignmentsSubmitted: 0,
      totalQuizzesPublished: 0,
      classes: [],
    };
  }

  const classIds = classes.map(c => c.id);
  const teacherIds = [
    ...new Set(
      classes.map(c => c.teacher_id).filter((id): id is string => id != null),
    ),
  ];

  // ── 4. Teacher names (same-school: second cross-tenant lock) ──────────────
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

  // ── 5. Active enrollment count per class ──────────────────────────────────
  const { data: enrollRows } = await admin
    .from('enrollments')
    .select('class_id')
    .in('class_id', classIds)
    .eq('is_active', true);

  const enrollments = (enrollRows as Array<{ class_id: string }> | null) ?? [];
  const enrollmentCount = new Map<string, number>();
  for (const e of enrollments) {
    enrollmentCount.set(e.class_id, (enrollmentCount.get(e.class_id) ?? 0) + 1);
  }

  // ── 6. Assignments per class (.in scoped to classIds) ─────────────────────
  const { data: assignmentRows } = await admin
    .from('assignments')
    .select('id, class_id')
    .in('class_id', classIds);

  const assignments = (
    assignmentRows as Array<{ id: string; class_id: string }> | null
  ) ?? [];

  const assignmentsCreatedPerClass = new Map<string, number>();
  const assignmentToClass = new Map<string, string>();
  for (const a of assignments) {
    assignmentsCreatedPerClass.set(
      a.class_id,
      (assignmentsCreatedPerClass.get(a.class_id) ?? 0) + 1,
    );
    assignmentToClass.set(a.id, a.class_id);
  }

  const assignmentIds = assignments.map(a => a.id);

  // ── 7. Submitted homework_attempts (.in scoped to assignmentIds) ──────────
  const submittedPerClass = new Map<string, number>();
  if (assignmentIds.length > 0) {
    const { data: hwRows } = await admin
      .from('homework_attempts')
      .select('assignment_id')
      .in('assignment_id', assignmentIds)
      .not('submitted_at', 'is', null);

    const hwAttempts = (
      hwRows as Array<{ assignment_id: string }> | null
    ) ?? [];

    for (const ha of hwAttempts) {
      const cid = assignmentToClass.get(ha.assignment_id);
      if (!cid) continue;
      submittedPerClass.set(cid, (submittedPerClass.get(cid) ?? 0) + 1);
    }
  }

  // ── 8. Published quizzes per class ────────────────────────────────────────
  const { data: quizRows } = await admin
    .from('quizzes')
    .select('class_id')
    .in('class_id', classIds)
    .not('published_at', 'is', null);

  const quizzes = (quizRows as Array<{ class_id: string }> | null) ?? [];
  const quizzesPerClass = new Map<string, number>();
  for (const q of quizzes) {
    quizzesPerClass.set(q.class_id, (quizzesPerClass.get(q.class_id) ?? 0) + 1);
  }

  // ── Compose per-class rows ────────────────────────────────────────────────
  const classReport: SchoolReportClass[] = classes.map(cls => ({
    classId: cls.id,
    className: cls.name,
    teacherName:
      cls.teacher_id != null ? (teacherMap.get(cls.teacher_id) ?? null) : null,
    enrolledStudents: enrollmentCount.get(cls.id) ?? 0,
    assignmentsCreated: assignmentsCreatedPerClass.get(cls.id) ?? 0,
    assignmentsSubmitted: submittedPerClass.get(cls.id) ?? 0,
    quizzesPublished: quizzesPerClass.get(cls.id) ?? 0,
  }));

  const totalAssignmentsSubmitted = classReport.reduce(
    (s, c) => s + c.assignmentsSubmitted,
    0,
  );
  const totalQuizzesPublished = classReport.reduce(
    (s, c) => s + c.quizzesPublished,
    0,
  );

  return {
    schoolName: (schoolRow as { name: string } | null)?.name ?? '',
    totalStudents: studentCount ?? 0,
    totalTeachers: teacherCount ?? 0,
    totalClasses: classes.length,
    totalAssignmentsSubmitted,
    totalQuizzesPublished,
    classes: classReport,
  };
}
