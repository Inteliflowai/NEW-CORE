/**
 * src/lib/roster/importRoster.ts
 *
 * Full 5-sheet roster import engine. Processes Teachers → Classes → Students →
 * Enrollments → Parents in that order so later sheets can resolve emails/classes.
 *
 * Account creation delegates entirely to ensureAuthUser (account-takeover-safe,
 * never calls admin.auth.admin.createUser directly — §F).
 *
 * supabase-js returns { error } and does NOT throw — every call checks { error }.
 * Emails are lowercased for every lookup (§C dedup discipline).
 *
 * Enrollment seats are stamped source='file' to distinguish from GC-synced seats.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureAuthUser } from '@/lib/trial/ensureAuthUser';
import type { ParsedRoster } from '@/lib/roster/types';

// ---------------------------------------------------------------------------
// Default passwords (exported so callers / tests can assert on them)
// ---------------------------------------------------------------------------
export const DEFAULT_STAFF_PW    = 'Core2026!';
export const DEFAULT_STUDENT_PW  = 'Student2026!';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------
export interface ImportSummary {
  teachers:    { created: number; skipped: number; errors: number };
  classes:     { created: number; skipped: number; errors: number };
  students:    { created: number; skipped: number; errors: number };
  enrollments: { created: number; skipped: number; errors: number };
  parents:     { created: number; linked: number; skipped: number; errors: number };
  issues: string[];
}

export async function importRoster(
  admin: SupabaseClient,
  args: { schoolId: string; roster: ParsedRoster },
): Promise<ImportSummary> {
  const { schoolId, roster } = args;

  const summary: ImportSummary = {
    teachers:    { created: 0, skipped: 0, errors: 0 },
    classes:     { created: 0, skipped: 0, errors: 0 },
    students:    { created: 0, skipped: 0, errors: 0 },
    enrollments: { created: 0, skipped: 0, errors: 0 },
    parents:     { created: 0, linked: 0, skipped: 0, errors: 0 },
    issues: [],
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  // In-session cache: email → { id, role }. Populated when we create or find a user
  // so that later sheets (Classes, Enrollments, Parents) can resolve IDs without
  // hitting the DB for every row, and so that a user created by ensureAuthUser
  // (which is mocked in tests and won't actually write to the fake DB) is still
  // resolvable in subsequent processing steps.
  // NOTE: cache key is email-only (no school_id) — safe because this Map lives for
  // one single-school importRoster call; a multi-school engine would need (school_id,email) keys.
  const userCache = new Map<string, { id: string; role: string }>();

  /** Look up a user by lowercased email + school_id. Checks the session cache first,
   *  then falls back to a DB query. */
  async function findUserByEmail(
    email: string,
  ): Promise<{ id: string; role: string } | null> {
    const lower = email.toLowerCase();
    if (userCache.has(lower)) return userCache.get(lower)!;
    const { data, error } = await (admin
      .from('users')
      .select('id, role')
      .eq('email', lower)
      .eq('school_id', schoolId) as unknown as Promise<{ data: Array<{ id: string; role: string }> | null; error: { message: string } | null }>);
    if (error || !data) return null;
    const row = data[0] ?? null;
    if (row) userCache.set(lower, row);
    return row;
  }

  /** Record a user in the session cache (called after ensureAuthUser creates one). */
  function cacheUser(email: string, id: string, role: string): void {
    userCache.set(email.toLowerCase(), { id, role });
  }

  // -------------------------------------------------------------------------
  // Sheet 1 — Teachers
  // -------------------------------------------------------------------------
  for (const row of roster.teachers) {
    if (!row.email) continue;
    const lower = row.email.toLowerCase();
    try {
      const existing = await findUserByEmail(lower);
      if (existing) {
        // Exists with any role → skip (do not change role per brief §22)
        summary.teachers.skipped++;
        continue;
      }
      const teacherId = await ensureAuthUser({
        admin,
        email: lower,
        password: row.password || DEFAULT_STAFF_PW,
        full_name: row.fullName,
        role: 'teacher',
        school_id: schoolId,
      });
      cacheUser(lower, teacherId, 'teacher');
      summary.teachers.created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A rebind/mismatch throw → skipped + issue (not an error)
      if (/rebind|mismatch/i.test(msg)) {
        summary.teachers.skipped++;
        summary.issues.push(`Teacher: rebind refused for ${lower} — ${msg}`);
      } else {
        summary.teachers.errors++;
        summary.issues.push(`Teacher: failed to create ${lower} — ${msg}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Sheet 2 — Classes
  // -------------------------------------------------------------------------
  for (const row of roster.classes) {
    try {
      // Resolve teacher_id (must exist in users after the Teachers pass)
      const teacher = row.teacherEmail ? await findUserByEmail(row.teacherEmail.toLowerCase()) : null;
      if (!teacher) {
        summary.classes.errors++;
        summary.issues.push(`Class: teacher '${row.teacherEmail}' not found for class '${row.name}'`);
        continue;
      }
      if (teacher.role !== 'teacher') {
        summary.classes.errors++;
        summary.issues.push(`Class: '${row.name}' — teacher email '${row.teacherEmail}' is not a teacher`);
        continue;
      }

      // Find-or-create by (name, teacher_id, period, school_id)
      const { data: existing, error: selErr } = await admin
        .from('classes')
        .select('id')
        .eq('school_id', schoolId)
        .eq('name', row.name)
        .eq('teacher_id', teacher.id)
        .eq('period', row.period)
        .maybeSingle();

      if (selErr) {
        summary.classes.errors++;
        console.error('[roster-import] Class lookup error for', row.name, ':', selErr);
        summary.issues.push(`Class: '${row.name}' could not be looked up (a database error occurred).`);
        continue;
      }
      if (existing) {
        summary.classes.skipped++;
        continue;
      }

      const { error: insErr } = await admin.from('classes').insert({
        school_id: schoolId,
        name: row.name,
        subject: row.subject,
        grade_level: row.gradeLevel,
        period: row.period,
        teacher_id: teacher.id,
        is_active: true,
      });

      if (insErr) {
        summary.classes.errors++;
        console.error('[roster-import] Class insert error for', row.name, ':', insErr);
        summary.issues.push(`Class: '${row.name}' could not be saved (a database error occurred).`);
        continue;
      }
      summary.classes.created++;
    } catch (err) {
      summary.classes.errors++;
      console.error('[roster-import] Class unexpected error for', row.name, ':', err);
      summary.issues.push(`Class: '${row.name}' could not be processed (an unexpected error occurred).`);
    }
  }

  // -------------------------------------------------------------------------
  // Sheet 3 — Students
  // -------------------------------------------------------------------------
  for (const row of roster.students) {
    if (!row.email) continue;
    const lower = row.email.toLowerCase();
    try {
      const existing = await findUserByEmail(lower);
      if (existing) {
        summary.students.skipped++;
        continue;
      }
      const studentId = await ensureAuthUser({
        admin,
        email: lower,
        password: row.password || DEFAULT_STUDENT_PW,
        full_name: row.fullName,
        role: 'student',
        school_id: schoolId,
      });
      cacheUser(lower, studentId, 'student');
      summary.students.created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/rebind|mismatch/i.test(msg)) {
        summary.students.skipped++;
        summary.issues.push(`Student: rebind refused for ${lower} — ${msg}`);
      } else {
        summary.students.errors++;
        summary.issues.push(`Student: failed to create ${lower} — ${msg}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Sheet 4 — Enrollments
  // -------------------------------------------------------------------------
  for (const row of roster.enrollments) {
    try {
      const studentLower = row.studentEmail.toLowerCase();
      const student = await findUserByEmail(studentLower);
      if (!student) {
        summary.enrollments.errors++;
        summary.issues.push(`Enrollment: student '${studentLower}' not found`);
        continue;
      }

      // Resolve class by V1 fallback chain:
      // 1. (name, teacher_id, period, school_id)
      // 2. (name, period, school_id)
      // 3. (name, school_id)
      let classId: string | null = null;

      const teacher = row.teacherEmail ? await findUserByEmail(row.teacherEmail.toLowerCase()) : null;

      // c1: disambiguate by (name, teacher_id, period) — only when the resolved user is
      // actually a teacher; a non-teacher id would never match a class's teacher_id
      if (teacher && teacher.role === 'teacher') {
        const { data: c1, error: e1 } = await admin
          .from('classes')
          .select('id')
          .eq('school_id', schoolId)
          .eq('name', row.className)
          .eq('teacher_id', teacher.id)
          .eq('period', row.period)
          .maybeSingle();
        if (!e1 && c1) classId = (c1 as { id: string }).id;
      }

      if (!classId) {
        const { data: c2, error: e2 } = await admin
          .from('classes')
          .select('id')
          .eq('school_id', schoolId)
          .eq('name', row.className)
          .eq('period', row.period)
          .maybeSingle();
        if (!e2 && c2) classId = (c2 as { id: string }).id;
      }

      if (!classId) {
        const { data: c3, error: e3 } = await admin
          .from('classes')
          .select('id')
          .eq('school_id', schoolId)
          .eq('name', row.className)
          .maybeSingle();
        if (!e3 && c3) classId = (c3 as { id: string }).id;
      }

      if (!classId) {
        summary.enrollments.errors++;
        summary.issues.push(`Enrollment: class '${row.className}' not found for student '${studentLower}'`);
        continue;
      }

      // Check for existing seat
      const { data: existingSeat, error: seatErr } = await admin
        .from('enrollments')
        .select('id')
        .eq('class_id', classId)
        .eq('student_id', student.id)
        .maybeSingle();

      if (seatErr) {
        summary.enrollments.errors++;
        console.error('[roster-import] Enrollment seat-check error for', studentLower, ':', seatErr);
        summary.issues.push(`Enrollment: could not check existing seat for '${studentLower}' (a database error occurred).`);
        continue;
      }
      if (existingSeat) {
        summary.enrollments.skipped++;
        continue;
      }

      const { error: insErr } = await admin.from('enrollments').insert({
        class_id: classId,
        student_id: student.id,
        is_active: true,
        source: 'file',
      });

      if (insErr) {
        // 23514 = check_violation — seat cap; count as a skip, not an error.
        const code = (insErr as { code?: string }).code;
        if (code === '23514') {
          summary.issues.push(`Seat limit reached for this school's license — '${studentLower}' was not enrolled.`);
        } else {
          summary.enrollments.errors++;
          console.error('[roster-import] Enrollment insert error for', studentLower, ':', insErr);
          summary.issues.push(`Enrollment: could not enroll '${studentLower}' (a database error occurred).`);
        }
        continue;
      }
      summary.enrollments.created++;
    } catch (err) {
      summary.enrollments.errors++;
      console.error('[roster-import] Enrollment unexpected error for', row.studentEmail, ':', err);
      summary.issues.push(`Enrollment: could not process row for '${row.studentEmail}' (an unexpected error occurred).`);
    }
  }

  // -------------------------------------------------------------------------
  // Sheet 5 — Parents
  // -------------------------------------------------------------------------
  for (const row of roster.parents) {
    if (!row.email) continue;
    const lower = row.email.toLowerCase();
    try {
      const studentLower = row.studentEmail.toLowerCase();
      const student = await findUserByEmail(studentLower);
      if (!student) {
        summary.parents.errors++;
        summary.issues.push(`Parent: student '${studentLower}' not found for parent '${lower}'`);
        continue;
      }

      // Reuse or create parent
      const existingParent = await findUserByEmail(lower);
      let parentId: string;

      if (existingParent) {
        // Update full_name only (never change role/school_id)
        parentId = existingParent.id;
        const { error: nameErr } = await (admin
          .from('users')
          .update({ full_name: row.fullName })
          .eq('id', parentId) as unknown as Promise<{ error: { message: string } | null }>);
        if (nameErr) {
          console.error('[roster-import] Parent name-update error for', lower, ':', nameErr);
          summary.issues.push(`Parent: could not update name for '${lower}' (a database error occurred).`);
        }
        summary.parents.linked++;
      } else {
        parentId = await ensureAuthUser({
          admin,
          email: lower,
          password: row.password || DEFAULT_STAFF_PW,
          full_name: row.fullName,
          role: 'parent',
          school_id: schoolId,
        });
        cacheUser(lower, parentId, 'parent');
        summary.parents.created++;
      }

      // Link parent_id on the student
      const { error: linkErr } = await (admin
        .from('users')
        .update({ parent_id: parentId })
        .eq('id', student.id) as unknown as Promise<{ error: { message: string } | null }>);

      if (linkErr) {
        console.error('[roster-import] Parent link error for student', studentLower, ':', linkErr);
        summary.issues.push(`Parent: could not link parent to student '${studentLower}' (a database error occurred).`);
        summary.parents.errors++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/rebind|mismatch/i.test(msg)) {
        summary.parents.skipped++;
        summary.issues.push(`Parent: rebind refused for ${lower} — ${msg}`);
      } else {
        summary.parents.errors++;
        summary.issues.push(`Parent: failed to create ${lower} — ${msg}`);
      }
    }
  }

  return summary;
}
