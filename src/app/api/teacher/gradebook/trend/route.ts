// src/app/api/teacher/gradebook/trend/route.ts
// GET /api/teacher/gradebook/trend?studentId=&classId=
// Per-student grade-over-time trend for the drill-in + profile sparkline.
// Auth chain: getUser → 401; guardStudentAccess(studentId) → guard response (IDOR — RLS is NOT
// the backstop on the admin client). Then admin client reads via loadStudentGradeTrend.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
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

  const guard = await guardStudentAccess(studentId);
  if (guard) return guard;

  const admin = createAdminSupabaseClient();
  const trend = await loadStudentGradeTrend(admin, { studentId, classId });
  return NextResponse.json(trend);
}
