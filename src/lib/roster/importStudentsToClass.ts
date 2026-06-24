/**
 * src/lib/roster/importStudentsToClass.ts
 *
 * Lean students-to-class import engine. Given a list of StudentRows and a
 * resolved classId (already verified by the caller via guardClassAccess),
 * this engine:
 *   1. Skips rows with no email.
 *   2. Deduplicates by (lowercased email, school_id) — find-or-create via ensureAuthUser.
 *   3. Refuses to rebind a non-student email (rebind-refusal → issue, no error count).
 *   4. Upserts enrollment into the one class, stamped source='file'.
 *
 * The caller (the route) has already verified the class belongs to the school
 * and to the requesting teacher via guardClassAccess — this engine does NOT
 * re-check class ownership.
 *
 * supabase-js returns { error } and does NOT throw — every call checks { error }.
 * Emails are lowercased for every lookup.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureAuthUser } from '@/lib/trial/ensureAuthUser';
import { DEFAULT_STUDENT_PW } from '@/lib/roster/importRoster';
import type { StudentRow } from '@/lib/roster/types';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface LeanImportSummary {
  studentsCreated:  number;
  studentsExisting: number;
  enrolled:         number;
  alreadyEnrolled:  number;
  errors:           number;
  issues:           string[];
}

export async function importStudentsToClass(
  admin: SupabaseClient,
  args: { schoolId: string; classId: string; students: StudentRow[] },
): Promise<LeanImportSummary> {
  const { schoolId, classId, students } = args;

  const summary: LeanImportSummary = {
    studentsCreated:  0,
    studentsExisting: 0,
    enrolled:         0,
    alreadyEnrolled:  0,
    errors:           0,
    issues:           [],
  };

  for (const row of students) {
    // Step 1: skip rows with no email
    if (!row.email) continue;

    const lower = row.email.toLowerCase();

    // Step 2: dedup by (email, school_id)
    const { data, error: lookupErr } = await (admin
      .from('users')
      .select('id, role')
      .eq('email', lower)
      .eq('school_id', schoolId) as unknown as Promise<{
        data: Array<{ id: string; role: string }> | null;
        error: { message: string } | null;
      }>);

    if (lookupErr || !data) {
      summary.errors++;
      console.error('[roster-import] Student lookup error for', lower, ':', lookupErr);
      summary.issues.push(`Student: '${lower}' could not be looked up (a database error occurred).`);
      continue;
    }

    const existing = data[0] ?? null;
    let studentId: string;

    if (existing) {
      // Step 3: rebind-refusal — non-student roles must not be converted
      if (existing.role !== 'student') {
        summary.issues.push(
          `Student: rebind refused for ${lower} — existing user has role '${existing.role}' (not student)`,
        );
        continue;
      }
      // Reuse existing student account
      studentId = existing.id;
      summary.studentsExisting++;
    } else {
      // Create new student account via ensureAuthUser (account-takeover-safe)
      try {
        studentId = await ensureAuthUser({
          admin,
          email:     lower,
          password:  row.password || DEFAULT_STUDENT_PW,
          full_name: row.fullName,
          role:      'student',
          school_id: schoolId,
        });
        summary.studentsCreated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A rebind/role/takeover-refusal throw → skip + issue (not an error),
        // mirroring importRoster.ts's catch-classification.
        if (/rebind|mismatch|role/i.test(msg)) {
          summary.issues.push(`Student: rebind refused for ${lower} — existing account has a conflicting role or school.`);
        } else {
          summary.errors++;
          summary.issues.push(`Student: '${lower}' could not be created (an unexpected error occurred).`);
        }
        continue;
      }
    }

    // Step 4: check for existing enrollment seat
    const { data: seat, error: seatErr } = await admin
      .from('enrollments')
      .select('id')
      .eq('class_id', classId)
      .eq('student_id', studentId)
      .maybeSingle();

    if (seatErr) {
      summary.errors++;
      console.error('[roster-import] Enrollment seat-check error for', lower, ':', seatErr);
      summary.issues.push(`Student: could not check enrollment for '${lower}' (a database error occurred).`);
      continue;
    }

    if (seat) {
      summary.alreadyEnrolled++;
      continue;
    }

    // Insert enrollment seat stamped source='file'
    const { error: insErr } = await admin.from('enrollments').insert({
      class_id:   classId,
      student_id: studentId,
      is_active:  true,
      source:     'file',
    });

    if (insErr) {
      summary.errors++;
      console.error('[roster-import] Enrollment insert error for', lower, ':', insErr);
      summary.issues.push(`Enrollment: could not enroll '${lower}' (a database error occurred).`);
      continue;
    }

    summary.enrolled++;
  }

  return summary;
}
