// src/lib/google/linkOrCreateStudent.ts
// The roster-import per-student path: match-or-create a student, then write/harden the
// external_identities google-id row (provider='google', external_id=googleUserId). Match by
// LOWERCASED email; create via the shared ensureAuthUser guard (honors the account-takeover
// contract — a role/school mismatch HARD-FAILS and is caught here as rebind_refused, never rebinds,
// never aborts the import). No-email / ambiguous / non-student-role → skipped with a reason.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureAuthUser } from '@/lib/trial/ensureAuthUser';
import { generateTrialPassword } from '@/lib/trial/generatePassword';

export type LinkResult =
  | { outcome: 'created' | 'linked'; studentId: string }
  | { outcome: 'skipped'; reason: 'no_email' | 'ambiguous' | 'rebind_refused' | 'error' };

export interface LinkArgs { schoolId: string; googleId: string; email: string; name: string }

async function writeIdentity(admin: SupabaseClient, args: { schoolId: string; googleId: string; email: string; studentId: string }) {
  const { error } = await admin.from('external_identities').upsert(
    {
      school_id: args.schoolId,
      provider: 'google',
      external_id: args.googleId,
      core_student_id: args.studentId,
      email: args.email.toLowerCase(),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'school_id,provider,external_id' },
  );
  if (error) console.error('[gc] identity write failed (non-fatal):', error.message);
}

export async function linkOrCreateStudent(admin: SupabaseClient, args: LinkArgs): Promise<LinkResult> {
  const email = (args.email ?? '').trim().toLowerCase();
  if (!email) return { outcome: 'skipped', reason: 'no_email' };

  try {
    // 1. Existing google identity row → link (harden last_seen below).
    const { data: idRow, error: idRowError } = await admin
      .from('external_identities')
      .select('core_student_id')
      .eq('school_id', args.schoolId)
      .eq('provider', 'google')
      .eq('external_id', args.googleId)
      .maybeSingle();
    if (idRowError) return { outcome: 'skipped', reason: 'error' };
    if (idRow?.core_student_id) {
      const studentId = idRow.core_student_id as string;
      await writeIdentity(admin, { schoolId: args.schoolId, googleId: args.googleId, email, studentId });
      return { outcome: 'linked', studentId };
    }

    // 2. Match existing public.users rows by lowercased email within the school. Exact .eq() on
    //    the lowercased value (NOT .ilike — an identity key must not be a LIKE pattern; IMP-5).
    const { data: userRows, error: userRowsError } = await admin
      .from('users')
      .select('id, role')
      .eq('school_id', args.schoolId)
      .eq('email', email);
    if (userRowsError) return { outcome: 'skipped', reason: 'error' };
    const rows = (userRows as Array<{ id: string; role: string }> | null) ?? [];
    // Role-collision guard FIRST: if the email is used by ANY non-student role (teacher/admin/
    // parent), refuse — even if a student row also matches (never rebind a staff email; IMP-5).
    if (rows.some((r) => r.role !== 'student')) return { outcome: 'skipped', reason: 'rebind_refused' };
    const students = rows.filter((r) => r.role === 'student');
    if (students.length > 1) return { outcome: 'skipped', reason: 'ambiguous' };

    let studentId: string;
    let outcome: 'created' | 'linked';
    if (students.length === 1) {
      studentId = students[0].id;
      outcome = 'linked';
    } else {
      // 3. No match → create via the account-takeover guard (throws on a role/school mismatch).
      studentId = await ensureAuthUser({
        admin,
        email,
        password: generateTrialPassword(),
        full_name: args.name || email,
        role: 'student',
        school_id: args.schoolId,
      });
      outcome = 'created';
    }
    await writeIdentity(admin, { schoolId: args.schoolId, googleId: args.googleId, email, studentId });
    return { outcome, studentId };
  } catch (err) {
    if (err instanceof Error && /refus|rebind|mismatch/i.test(err.message)) {
      return { outcome: 'skipped', reason: 'rebind_refused' };
    }
    console.error('[gc] linkOrCreateStudent failed (skipped):', err instanceof Error ? err.message : 'unknown');
    return { outcome: 'skipped', reason: 'error' };
  }
}
