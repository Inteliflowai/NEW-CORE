/**
 * src/app/api/admin/provision-trial/route.ts
 *
 * POST /api/admin/provision-trial
 * Platform-admin-only endpoint: provisions a new trial school + teacher + demo data.
 *
 * Auth chain (p4b-02-auth.md):
 *   1. createServerSupabaseClient → getUser (401 if no session)
 *   2. guardPlatformAdmin() (403 if not platform_admin)
 *
 * Body: { school_name, teacher_email, teacher_name, student_roster[], parent?, trial_plan, student_limit }
 * Success: 201 { school_id, trial_expires_at, credentials_summary }
 * Validation failure: 400 { error }
 * provisionTrial throw: 500 { error: 'Internal server error' }  (no internals leaked)
 *
 * IMPORTANT: credentials (password) are returned ONCE in credentials_summary and
 * NEVER written to any log in this handler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardPlatformAdmin } from '@/lib/auth/guards';
import { provisionTrial } from '@/lib/trial/provisionTrial';
import { validateProvisionInput } from './validate';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Auth — session check ───────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Auth — platform_admin gate ────────────────────────────────────────
  const guard = await guardPlatformAdmin();
  if (guard) return guard;

  // ── 3. Parse + validate body ──────────────────────────────────────────────
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

  const { school_name, teacher_email, teacher_name, trial_plan, student_limit } = result.value;

  // ── 4. Provision ─────────────────────────────────────────────────────────
  const admin = createAdminSupabaseClient();
  let provisionResult;
  try {
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

  // ── 5. Build response — credentials_summary surfaced once, never logged ───
  const credentials_summary: Record<string, { email: string }> = {};
  for (const [role, cred] of Object.entries(provisionResult.credentials)) {
    credentials_summary[role] = { email: cred.email };
  }

  return NextResponse.json(
    {
      school_id: provisionResult.schoolId,
      trial_expires_at: provisionResult.trialExpiresAt,
      credentials_summary,
      /**
       * The shared password is surfaced here ONCE so the admin can relay it to
       * the school. It is NOT stored in logs; the caller must handle it securely.
       */
      shared_password: provisionResult.password,
    },
    { status: 201 },
  );
}
