// src/app/api/teacher/class/[classId]/roster-signals/route.ts
// GET /api/teacher/class/[classId]/roster-signals
//
// Thin HTTP wrapper around loadRosterSignals().
//
// Auth flow:
//   1. auth.getUser() → 401 if not authenticated
//   2. C8 STAFF ROLE GATE: 403 unless teacher|school_admin|school_sysadmin|platform_admin
//      (guardClassAccess alone is class-scoped, not role-scoped — students/parents out)
//   3. guardClassAccess(classId) → 403 on IDOR
//
// Data gathering is fully delegated to loadRosterSignals() so that a Server
// Component page can call the same function without an HTTP round-trip.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';

/** Staff roles that are allowed to see teacher-facing roster data. */
const STAFF_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ classId: string }> },
): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
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

  const { classId } = await params;

  // ── 3. Object-level IDOR guard ─────────────────────────────────────────────
  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  const admin = createAdminSupabaseClient();
  return NextResponse.json(await loadRosterSignals(admin, classId));
}
