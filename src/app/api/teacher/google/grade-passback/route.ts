// POST /api/teacher/google/grade-passback — push DRAFT grades from CORE → Google Classroom
// for a published assignment courseWork.
// Body: { classId, lessonId } — C1: the assignment unit is the LESSON, not a single assignment row.
// Auth chain mirrors google/sync/route.ts exactly: getUser → STAFF_ROLES → parse body →
// guardClassAccess → admin client → resolve class row → 400 if no google_course_id.
// Token fetch is INSIDE the try/catch (M5) so GoogleNotConnectedError → gcErrorResponse, not 500.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { getValidAccessTokenForTeacher } from '@/lib/google/tokens';
import { gradePassback } from '@/lib/google/gradePassback';
import { gcErrorResponse } from '@/lib/google/errorEnvelope';
import { logAudit } from '@/lib/audit/logAudit';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth chain (mirrors sync/route.ts exactly) ─────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if (!STAFF_ROLES.includes(profile?.role as typeof STAFF_ROLES[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { classId?: string; lessonId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad Request' }, { status: 400 }); }

  const classId = (body.classId ?? '').trim();
  const lessonId = (body.lessonId ?? '').trim();

  if (!classId) return NextResponse.json({ error: 'classId required' }, { status: 400 });
  if (!lessonId) return NextResponse.json({ error: 'lessonId required' }, { status: 400 });

  // REAL guardClassAccess contract: null = proceed; a NextResponse = deny.
  const denied = await guardClassAccess(classId);
  if (denied) return denied;

  const admin = createAdminSupabaseClient();
  const { data: cls } = await admin
    .from('classes')
    .select('id, teacher_id, school_id, google_course_id')
    .eq('id', classId)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!cls.google_course_id) return NextResponse.json({ error: 'Not a Google-mirrored class' }, { status: 400 });

  // ── Resolve publication row ────────────────────────────────────────────────
  // Look up the google_publications row for (resource_type:'assignment', resource_id: lessonId,
  // google_course_id: cls.google_course_id). If absent OR grade_passback_enabled is false → 400.
  const { data: pub } = await admin
    .from('google_publications')
    .select('id, google_coursework_id, grade_passback_enabled, max_points')
    .eq('resource_type', 'assignment')
    .eq('resource_id', lessonId)
    .eq('google_course_id', cls.google_course_id as string)
    .maybeSingle();

  if (!pub || !(pub as { grade_passback_enabled: boolean }).grade_passback_enabled) {
    return NextResponse.json({ error: 'not_published' }, { status: 400 });
  }

  const publication = pub as {
    id: string;
    google_coursework_id: string;
    grade_passback_enabled: boolean;
    max_points: number;
  };

  // ── Grade passback (token fetch INSIDE try — M5) ──────────────────────────
  try {
    const token = await getValidAccessTokenForTeacher(admin, cls.teacher_id as string);

    const result = await gradePassback(admin, {
      token,
      schoolId: cls.school_id as string,
      classId,
      lessonId,
      googleCourseId: cls.google_course_id as string,
      courseWorkId: publication.google_coursework_id,
      maxPoints: publication.max_points,
    });

    // Always update so a stale last_sync_error is cleared on a clean run (minor-fix).
    await admin
      .from('google_publications')
      .update({
        last_sync_error: result.errors > 0 ? `${result.errors} grade(s) failed` : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', publication.id);

    await logAudit(admin, {
      actorId: user.id,
      schoolId: cls.school_id as string,
      action: 'gc.grade_passback',
      resourceType: 'google_publication',
      resourceId: publication.google_coursework_id,
      metadata: result as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return gcErrorResponse(err);
  }
}
