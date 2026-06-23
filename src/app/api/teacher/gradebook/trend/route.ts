// src/app/api/teacher/gradebook/trend/route.ts
// GET /api/teacher/gradebook/trend?studentId=&classId=
// Per-student grade-over-time trend for the drill-in + profile sparkline.
// Auth chain: getUser → 401; STAFF_ROLES gate → 403 (this is a /api/teacher route and the proxy
// does NOT role-gate /api/teacher/*, so the check lives here, mirroring the sibling override route);
// guardStudentAccess(studentId) → guard response (IDOR — RLS is NOT the backstop on the admin
// client). Then admin client reads via loadStudentGradeTrend.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardStudentAccess } from '@/lib/auth/guards';
import { loadStudentGradeTrend } from '@/lib/gradebook/loadStudentGradeTrend';

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get('studentId');
  const classId = searchParams.get('classId');
  if (!studentId || !classId) {
    return NextResponse.json({ error: 'Missing studentId or classId' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  // Staff-only (teacher namespace). The relationship guard below is not a role gate on its own —
  // a student/parent could otherwise pass guardStudentAccess for their own id.
  const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (roleRow as { role?: string } | null)?.role;
  if (!role || !new Set<string>(STAFF_ROLES).has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const guard = await guardStudentAccess(studentId);
  if (guard) return guard;

  const trend = await loadStudentGradeTrend(admin, { studentId, classId });
  return NextResponse.json(trend);
}
