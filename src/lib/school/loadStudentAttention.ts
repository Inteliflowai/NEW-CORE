// src/lib/school/loadStudentAttention.ts
// Pure loader for the school-admin Student Attention page.
// Returns only band-level data — NEVER risk_score, divergence, or any raw numeric.
// Caller is responsible for auth (resolveAdminContext + createAdminSupabaseClient).
// All queries are scoped to schoolId via explicit .eq('school_id', schoolId) guards.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AttentionStudent {
  studentId: string;
  name: string | null;
}

export interface AttentionClass {
  classId: string;
  className: string;
  students: AttentionStudent[];
}

export interface AttentionGrade {
  grade: string;
  classes: AttentionClass[];
}

export interface AttentionRollupData {
  grades: AttentionGrade[];
}

export async function loadStudentAttention(
  admin: SupabaseClient,
  schoolId: string,
): Promise<AttentionRollupData> {
  // ── Step 1: latest snapshot per student with mastery_band='reteach' ────────
  // Ordered desc so the first occurrence of each student_id is the latest.
  // CRITICAL: SELECT ONLY band-safe columns — never risk_score or divergence.
  const { data: snapshots } = await admin
    .from('student_model_snapshots')
    .select('student_id, mastery_band, snapshot_date')
    .eq('mastery_band', 'reteach')
    .order('snapshot_date', { ascending: false });

  // Dedupe to one entry per student_id (first = latest due to desc order)
  const seen = new Set<string>();
  const reteachStudentIds: string[] = [];
  for (const row of (snapshots ?? []) as Array<{
    student_id: string;
    mastery_band: string;
    snapshot_date: string;
  }>) {
    if (!seen.has(row.student_id)) {
      seen.add(row.student_id);
      reteachStudentIds.push(row.student_id);
    }
  }

  if (reteachStudentIds.length === 0) return { grades: [] };

  // ── Step 2: verify school membership + fetch grade_level ─────────────────
  // The .eq('school_id', schoolId) is the IDOR boundary — drops any student not
  // in this school before anything else touches them.
  const { data: userRows } = await admin
    .from('users')
    .select('id, full_name, grade_level')
    .in('id', reteachStudentIds)
    .eq('school_id', schoolId)
    .eq('is_active', true);

  const students = (userRows ?? []) as Array<{
    id: string;
    full_name: string | null;
    grade_level: string | null;
  }>;

  const schoolStudentIds = students.map(s => s.id);
  if (schoolStudentIds.length === 0) return { grades: [] };

  const studentMap = new Map(students.map(s => [s.id, s]));

  // ── Step 3: get active class memberships for these students ───────────────
  const { data: enrollRows } = await admin
    .from('enrollments')
    .select('student_id, class_id')
    .in('student_id', schoolStudentIds)
    .eq('is_active', true);

  const enrollments = (enrollRows ?? []) as Array<{
    student_id: string;
    class_id: string;
  }>;

  const classIds = [...new Set(enrollments.map(e => e.class_id))];
  if (classIds.length === 0) return { grades: [] };

  // ── Step 4: get class names, school-scoped for cross-tenant safety ─────────
  const { data: classRows } = await admin
    .from('classes')
    .select('id, name')
    .in('id', classIds)
    .eq('school_id', schoolId)
    .eq('is_active', true);

  const classMap = new Map(
    ((classRows ?? []) as Array<{ id: string; name: string }>).map(c => [c.id, c.name]),
  );

  // ── Step 5: group by grade → class → students ─────────────────────────────
  const gradeMap = new Map<string, Map<string, AttentionStudent[]>>();

  for (const enr of enrollments) {
    const student = studentMap.get(enr.student_id);
    if (!student) continue; // not in this school — already filtered, but belt-and-braces
    const className = classMap.get(enr.class_id);
    if (!className) continue; // class not in this school

    const grade = student.grade_level ?? 'Unknown';
    if (!gradeMap.has(grade)) gradeMap.set(grade, new Map());
    const classesForGrade = gradeMap.get(grade)!;
    if (!classesForGrade.has(enr.class_id)) classesForGrade.set(enr.class_id, []);
    const studentsInClass = classesForGrade.get(enr.class_id)!;

    // Guard against duplicate enrollment rows
    if (!studentsInClass.some(s => s.studentId === enr.student_id)) {
      studentsInClass.push({ studentId: enr.student_id, name: student.full_name });
    }
  }

  // ── Compose ordered result ────────────────────────────────────────────────
  const grades: AttentionGrade[] = [];
  for (const grade of [...gradeMap.keys()].sort()) {
    const classesMap = gradeMap.get(grade)!;
    const classes: AttentionClass[] = [];
    for (const [classId, classStudents] of classesMap) {
      classes.push({
        classId,
        className: classMap.get(classId) ?? classId,
        students: classStudents,
      });
    }
    grades.push({ grade, classes });
  }

  return { grades };
}
