// GET ?assignmentId= — on-demand SPARK attempt review for the challenges
// page "Student's work" panel. Auth mirrors gradebook/attempt:
// getUser → STAFF_ROLES → guardClassAccess (IDOR; RLS is NOT the backstop) →
// only THEN call SPARK server-to-server (per-school api_key, fail-soft).
// Answers are pre-formatted server-side through formatStepResponse so the
// media guards cannot be bypassed by a client rendering raw values.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { getSparkLink } from '@/lib/spark/sparkLink';
import { fetchAttemptReview } from '@/lib/spark/fetchAttemptReview';
import { formatStepResponse, type DisplaySegment } from '@/lib/spark/formatStepResponse';

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const assignmentId = new URL(req.url).searchParams.get('assignmentId');
  if (!assignmentId) return NextResponse.json({ error: 'Missing assignmentId' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (roleRow as { role?: string } | null)?.role;
  if (!role || !new Set<string>(STAFF_ROLES).has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: asg } = await admin.from('assignments')
    .select('id, class_id, student_id, spark_status').eq('id', assignmentId).maybeSingle();
  const assignment = asg as { id: string; class_id: string; student_id: string; spark_status: string | null } | null;
  if (!assignment || (assignment.spark_status ?? 'none') === 'none') {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }

  const guard = await guardClassAccess(assignment.class_id);
  if (guard) return guard;

  const { data: cls } = await admin.from('classes')
    .select('school_id').eq('id', assignment.class_id).maybeSingle();
  const schoolId = (cls as { school_id?: string } | null)?.school_id;
  if (!schoolId) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

  const link = await getSparkLink(admin, schoolId);
  if (!link) return NextResponse.json({ error: 'spark_not_enabled' }, { status: 404 });

  const result = await fetchAttemptReview({
    apiKey: link.api_key,
    coreHomeworkId: assignment.id,
    coreStudentId: assignment.student_id,
  });
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'not_started' }, { status: 404 });
    }
    return NextResponse.json({ error: 'spark_unreachable' }, { status: 502 });
  }

  const segmentsByStep: Record<number, DisplaySegment[]> = {};
  for (const r of result.review.stepResponses) {
    segmentsByStep[r.step_index] = formatStepResponse(r.type, r.value);
  }
  // The raw values never leave the server — the client renders segments only.
  const { stepResponses, ...rest } = result.review;
  const responseIndexes = stepResponses.map((r) => r.step_index);

  return NextResponse.json({ review: rest, responseIndexes, segmentsByStep });
}
