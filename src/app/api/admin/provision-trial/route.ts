/**
 * src/app/api/admin/provision-trial/route.ts
 *
 * POST /api/admin/provision-trial
 * Platform-admin-only endpoint: provisions a new trial school + teacher + demo data.
 *
 * Auth chain (p4b-02-auth.md):
 *   guardPlatformAdmin() handles session check (401 if no session) and role check
 *   (403 if not platform_admin). No redundant pre-guard getUser needed.
 *
 * Body: { school_name, teacher_email, teacher_name, student_roster[]?, parent?, trial_plan, student_limit }
 * Success: 201 { school_id, trial_expires_at, credentials_summary: { shared_password, accounts? } }
 * Validation failure: 400 { error }
 * provisionTrial throw: 500 { error: 'Internal server error' }  (no internals leaked)
 *
 * IMPORTANT: credentials (password) are returned ONCE in credentials_summary and
 * NEVER written to any log in this handler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardPlatformAdmin } from '@/lib/auth/guards';
import { provisionTrial } from '@/lib/trial/provisionTrial';
import { validateProvisionInput } from './validate';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Auth — guardPlatformAdmin handles session (401) + role (403) ───────
  const guard = await guardPlatformAdmin();
  if (guard) return guard;

  // ── 2. Parse + validate body ──────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = validateProvisionInput(rawBody as Record<string, unknown>);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { school_name, teacher_email, teacher_name, student_roster, trial_plan, student_limit } = result.value;

  // ── 3. Provision ─────────────────────────────────────────────────────────
  const admin = createAdminSupabaseClient();
  let provisionResult;
  try {
    // TODO: provisionTrial seeds the demo cast; wire caller-supplied roster when custom seeding lands
    // student_roster is validated and accepted above but not forwarded yet — provisionTrial seeds demo cast.
    provisionResult = await provisionTrial({
      admin,
      schoolName: school_name,
      teacherEmail: teacher_email,
      teacherName: teacher_name,
      trialPlan: trial_plan,
      studentLimit: student_limit,
    });
  } catch {
    // Do NOT leak internal error messages — they may contain school/user details
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // ── 4. Build response — credentials_summary surfaced once, never logged ───
  const accounts: Record<string, { email: string }> = {};
  for (const [role, cred] of Object.entries(provisionResult.credentials)) {
    accounts[role] = { email: cred.email };
  }

  /**
   * credentials_summary nests both the shared password (surfaced ONCE — caller
   * must handle securely, never logged) and the per-role account emails.
   */
  return NextResponse.json(
    {
      school_id: provisionResult.schoolId,
      trial_expires_at: provisionResult.trialExpiresAt,
      roster_status: 'deferred_demo_cast_seeded',
      credentials_summary: {
        shared_password: provisionResult.password,
        accounts,
      },
    },
    { status: 201 },
  );
}
