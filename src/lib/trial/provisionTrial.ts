/**
 * src/lib/trial/provisionTrial.ts
 *
 * Fused trial-provisioning orchestrator (V1 had TWO functions —
 * lib/trial/provisionTrial.ts for school+users and lib/licensing/trial.ts for the
 * license row; V2 fuses them into ONE).
 *
 * Order of operations (p4b-05 §3 + §9):
 *   1. INSERT schools          (is_trial:true, trial_status:'active', trial_plan, demo_mode:false)
 *   2. UPSERT school_licenses  (tier:'professional', status:'trialing', student_limit, trial_*; onConflict school_id)
 *   3. ensureAuthUser teacher  (caller-supplied teacher_email — the guard HARD-FAILS on role/school
 *                               mismatch, preventing cross-tenant rebind: R2/C14)
 *   4. ensureAuthUser parent + first student (Alex)        (soft-fail per demo account)
 *   5. UPDATE schools.trial_credentials  (shared password per role)
 *   6. seedTrialDemoData(...)            (soft-fail per step)
 *   7. logTrialEvent('trial_signup')     (soft-fail breadcrumb)
 *
 * HARD-FAIL-WITH-CLEANUP: if the school insert or the primary teacher fails, the
 * school row is deleted and the function throws. Everything after the teacher is
 * soft-fail so a partial provision is better than none (p4b-05 §15).
 *
 * Onboarding default: set-password / shared credentials stored in
 * schools.trial_credentials and returned in the result (magic-link is a future layer).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { ensureAuthUser } from '@/lib/trial/ensureAuthUser';
import { seedTrialDemoData, type SeedReport } from '@/lib/trial/seedTrialDemoData';
import { logTrialEvent } from '@/lib/trial/logTrialEvent';
import { generateTrialPassword, type Rng } from '@/lib/trial/generatePassword';
import { DEMO_STUDENTS, DEMO_PARENT } from '@/lib/demo/demoCast';

export interface ProvisionTrialInput {
  admin: SupabaseClient;
  schoolName: string;
  teacherEmail: string;          // caller-supplied — guard hard-fails on cross-tenant rebind
  teacherName: string;
  trialPlan?: string;            // schools.trial_plan; default 'pro'
  trialSource?: string | null;   // schools.trial_source
  studentLimit?: number;         // school_licenses.student_limit; default 300
  trialDays?: number;            // default 30
  /** Injected RNG for the shared password (defaults to Math.random in production). */
  rng?: Rng;
}

export interface TrialCredential {
  email: string;
  // password intentionally omitted from storage — travels only in ProvisionTrialResult.password
}

export interface ProvisionTrialResult {
  schoolId: string;
  teacherId: string;
  parentId: string | null;
  firstStudentId: string | null;
  password: string;
  trialExpiresAt: string;
  credentials: Record<string, TrialCredential>; // keyed by role: teacher/parent/student
  seedReport?: SeedReport; // present when seed ran (may have skipped steps)
}

export async function provisionTrial(input: ProvisionTrialInput): Promise<ProvisionTrialResult> {
  const {
    admin,
    schoolName,
    teacherEmail,
    teacherName,
    trialPlan = 'pro',
    trialSource = null,
    studentLimit = 300,
    trialDays = 30,
    rng = Math.random,
  } = input;

  const now = new Date();
  const trialExpiresAt = new Date(now.getTime() + trialDays * 86_400_000);
  const password = generateTrialPassword(rng);

  const schoolId = randomUUID();
  const schoolIdShort = schoolId.slice(0, 8);

  // ── Step 1: INSERT schools (HARD FAIL) ───────────────────────────────────────
  {
    const { error } = await admin.from('schools').insert({
      id: schoolId,
      name: schoolName,
      is_trial: true,
      trial_started_at: now.toISOString(),
      trial_expires_at: trialExpiresAt.toISOString(),
      trial_status: 'active',
      trial_plan: trialPlan,
      trial_source: trialSource,
      demo_mode: false,
      is_active: true,
    });
    if (error) throw new Error(`provisionTrial: failed to create school: ${error.message}`);
  }

  // Cleanup helper for the hard-fail path.
  const cleanupAndThrow = async (message: string): Promise<never> => {
    const { error: cleanupErr } = await admin.from('schools').delete().eq('id', schoolId);
    if (cleanupErr) {
      throw new Error(
        `provisionTrial: cleanup failed (${cleanupErr.message}) while handling: ${message}`
      );
    }
    throw new Error(message);
  };

  // ── Step 2: UPSERT school_licenses (HARD FAIL — fused from V1 licensing layer) ─
  {
    const { error } = await admin.from('school_licenses').upsert(
      {
        school_id: schoolId,
        tier: 'professional',
        status: 'trialing', // enforced by the seat-cap trigger as of migration 0026; default student_limit 300 gives pilots ample headroom
        student_limit: studentLimit,
        trial_starts_at: now.toISOString(),
        trial_ends_at: trialExpiresAt.toISOString(),
        trial_converted: false,
      },
      { onConflict: 'school_id' }
    );
    if (error) {
      return cleanupAndThrow(`provisionTrial: failed to create school_licenses: ${error.message}`);
    }
  }

  // ── Step 3: Teacher (HARD FAIL WITH CLEANUP) ─────────────────────────────────
  // The guard hard-fails on role/school mismatch of an existing auth user — this
  // is the cross-tenant rebind prevention (R2/C14). Any throw here triggers cleanup.
  let teacherId: string;
  try {
    teacherId = await ensureAuthUser({
      admin,
      email: teacherEmail,
      password,
      full_name: teacherName,
      role: 'teacher',
      school_id: schoolId,
    });
  } catch (e) {
    return cleanupAndThrow(`provisionTrial: failed to provision teacher: ${(e as Error).message}`);
  }

  // ── Step 4: Parent + first student (Alex) — soft fail per demo account ───────
  const firstStudent = DEMO_STUDENTS[0];
  const parentEmail = `demo-${DEMO_PARENT.key}@trial-${schoolIdShort}.core.com`;
  const firstStudentEmail = `demo-${firstStudent.key}@trial-${schoolIdShort}.core.com`;

  let parentId: string | null = null;
  try {
    parentId = await ensureAuthUser({
      admin,
      email: parentEmail,
      password,
      full_name: DEMO_PARENT.full_name,
      role: 'parent',
      school_id: schoolId,
    });
  } catch (e) {
    console.error('[trial] parent provisioning failed (soft):', (e as Error).message);
  }

  let firstStudentId: string | null = null;
  try {
    firstStudentId = await ensureAuthUser({
      admin,
      email: firstStudentEmail,
      password,
      full_name: firstStudent.full_name,
      role: 'student',
      school_id: schoolId,
    });
  } catch (e) {
    console.error('[trial] first-student provisioning failed (soft):', (e as Error).message);
  }

  // ── Step 5: UPDATE schools.trial_credentials (email-only per role) ──────────
  const credentials: Record<string, TrialCredential> = {
    teacher: { email: teacherEmail },
    parent:  { email: parentEmail },
    student: { email: firstStudentEmail },
  };
  {
    const { error } = await admin
      .from('schools')
      .update({ trial_credentials: credentials })
      .eq('id', schoolId);
    if (error) {
      console.error('[trial] trial_credentials update failed (soft):', error.message);
    }
  }

  // ── Step 6: Seed the demo dataset (soft-fail per step internally) ────────────
  let seedReport: SeedReport | undefined;
  try {
    seedReport = await seedTrialDemoData({
      admin,
      schoolId,
      schoolIdShort,
      teacherId,
      firstStudentId,
      parentId,
      password,
    });
    if (seedReport.skipped.length > 0) {
      console.warn(
        '[trial] seedTrialDemoData partial seed — skipped steps:',
        seedReport.skipped.map((s) => `${s.step}: ${s.reason}`).join('; ')
      );
    }
  } catch (e) {
    console.error('[trial] seedTrialDemoData failed (soft):', (e as Error).message);
  }

  // ── Step 7: Lifecycle breadcrumb (soft-fail) ─────────────────────────────────
  await logTrialEvent({
    admin,
    schoolId,
    userId: teacherId,
    eventType: 'trial_signup',
    metadata: { trial_plan: trialPlan, trial_source: trialSource },
  });

  return {
    schoolId,
    teacherId,
    parentId,
    firstStudentId,
    password,
    trialExpiresAt: trialExpiresAt.toISOString(),
    credentials,
    seedReport,
  };
}
