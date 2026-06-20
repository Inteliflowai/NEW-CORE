// src/app/api/attempts/spark-launch/route.ts — student → SPARK launch handoff (port of V1).
// Auth: getUser() → ownership guard (student_id === user.id) → admin client.
// Assembles a signed HS256 JWT (signLaunchJwt) and returns the deep-link launch_url into SPARK.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { signLaunchJwt } from '@/lib/spark/signLaunchJwt';
import { SPARK_API_URL, CORE_SPARK_API_SECRET } from '@/lib/spark/config';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { assignment_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 }); }
  const assignmentId = body.assignment_id;
  if (!assignmentId) return NextResponse.json({ error: 'Missing assignment_id' }, { status: 400 });

  if (!CORE_SPARK_API_SECRET) return NextResponse.json({ error: 'Spark integration not configured' }, { status: 500 });

  const admin = createAdminSupabaseClient();
  const { data: assignment } = await admin
    .from('assignments').select('id, student_id, spark_attempt_id').eq('id', assignmentId).maybeSingle();
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  if ((assignment.student_id as string) !== user.id) return NextResponse.json({ error: 'Not your assignment' }, { status: 403 });
  if (!assignment.spark_attempt_id) return NextResponse.json({ error: 'Spark not provisioned for this assignment' }, { status: 400 });

  const { data: student } = await admin.from('users').select('id, full_name, email, school_id').eq('id', user.id).maybeSingle();
  if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  if (!student.school_id) return NextResponse.json({ error: 'School not linked' }, { status: 400 });

  // Grade from active enrollment — may be absent (cold-start / not yet enrolled); graceful.
  const { data: enrollment } = await admin
    .from('enrollments')
    .select('class:classes(grade_level)')
    .eq('student_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  // Cast the nested join result to avoid Supabase TS inference (GenericStringError on deep joins).
  const grade = (enrollment?.class as { grade_level?: string } | null)?.grade_level || '';

  const origin = req.headers.get('origin') || req.nextUrl.origin;
  const returnUrl = `${origin}/student/assignments/${assignment.id as string}`;
  const token = signLaunchJwt({
    core_user_id: student.id as string,
    core_school_id: student.school_id as string,
    spark_attempt_id: assignment.spark_attempt_id as string,
    email: (student.email as string) ?? undefined,
    full_name: (student.full_name as string) ?? undefined,
    grade,
    return_url: returnUrl,
  });
  const redirectPath = `/student/experiment/${assignment.spark_attempt_id as string}`;
  const launch_url = `${SPARK_API_URL}/api/integration/auth?token=${token}&redirect=${encodeURIComponent(redirectPath)}`;
  return NextResponse.json({ launch_url });
}
