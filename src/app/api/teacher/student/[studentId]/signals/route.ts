// src/app/api/teacher/student/[studentId]/signals/route.ts
// GET /api/teacher/student/[studentId]/signals
//
// One-student signal bundle for the teacher view (Plan 3 Task 16 read API).
//
// Thin wrapper: auth → STAFF role gate → guardStudentAccess (IDOR) → admin client
// → loadStudentSignals (the data layer, src/lib/signals/loadStudentSignals.ts).
//
// Auth flow:
//   1. auth.getUser() → 401 if not authenticated
//   2. C8 STAFF ROLE GATE: 403 unless teacher|school_admin|school_sysadmin|platform_admin
//      (student/parent must not reach teacher-only tables)
//   3. guardStudentAccess(studentId) → 403 if IDOR
//
// Returns: current_band, per_skill_cl (CL_VERB_BY_STATE; null → "Not yet assessed"),
//          confidence as SOFT WORDS (not numbers), recurring misconceptions per skill,
//          divergence, effort pattern, roster risk, LIVE session risk (C3),
//          reteach outcomes, trajectory derived from snapshots (C3), growth_history.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardStudentAccess } from '@/lib/auth/guards';
import { loadStudentSignals } from '@/lib/signals/loadStudentSignals';

/** Staff roles that are allowed to see teacher-facing signal data. */
const STAFF_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. C8 STAFF ROLE GATE (BEFORE object guard) ────────────────────────────
  const { data: callerProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  const callerRole = callerProfile?.role ?? null;
  if (!callerRole || !STAFF_ROLES.has(callerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { studentId } = await params;

  // ── 3. Object-level IDOR guard ─────────────────────────────────────────────
  const guard = await guardStudentAccess(studentId);
  if (guard) return guard;

  // ── 4. Data layer ──────────────────────────────────────────────────────────
  const admin = createAdminSupabaseClient();
  const signals = await loadStudentSignals(admin, studentId);

  return NextResponse.json(signals);
}
