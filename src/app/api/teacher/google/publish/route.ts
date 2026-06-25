// POST /api/teacher/google/publish — publish a quiz or assignment as a DRAFT Google Classroom
// courseWork for a GC-mirrored class.
// Auth chain mirrors google/sync/route.ts exactly: getUser → STAFF_ROLES → parse body →
// guardClassAccess → admin client → resolve class row → 400 if no google_course_id.
// Token fetch is INSIDE the try/catch (M5) so GoogleNotConnectedError → gcErrorResponse, not 500.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { getValidAccessTokenForTeacher } from '@/lib/google/tokens';
import { publishToClassroom } from '@/lib/google/publishToClassroom';
import { gcErrorResponse } from '@/lib/google/errorEnvelope';
import { logAudit } from '@/lib/audit/logAudit';
import { APP_BASE_URL } from '@/lib/google/config';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth chain (mirrors sync/route.ts exactly) ─────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if (!STAFF_ROLES.includes(profile?.role as typeof STAFF_ROLES[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { classId?: string; resourceType?: string; resourceId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad Request' }, { status: 400 }); }

  const classId = (body.classId ?? '').trim();
  const resourceType = (body.resourceType ?? '').trim() as 'quiz' | 'assignment';
  const resourceId = (body.resourceId ?? '').trim();

  if (!classId) return NextResponse.json({ error: 'classId required' }, { status: 400 });
  if (resourceType !== 'quiz' && resourceType !== 'assignment') {
    return NextResponse.json({ error: 'resourceType must be "quiz" or "assignment"' }, { status: 400 });
  }
  if (!resourceId) return NextResponse.json({ error: 'resourceId required' }, { status: 400 });

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

  // ── Resolve unit title ─────────────────────────────────────────────────────
  // quiz → quizzes.title; assignment → lessons.title (resourceId = lessons.id, C1)
  let title: string;
  if (resourceType === 'quiz') {
    const { data: quiz } = await admin.from('quizzes').select('title').eq('id', resourceId).maybeSingle();
    if (!quiz) return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
    title = quiz.title as string;
  } else {
    const { data: lesson } = await admin.from('lessons').select('title').eq('id', resourceId).maybeSingle();
    if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
    title = lesson.title as string;
  }

  // ── Build CORE deep-links (C5) ─────────────────────────────────────────────
  const linkUrl = `${APP_BASE_URL}/?gc=${resourceType}&id=${resourceId}`;
  const courseLinkUrl = `${APP_BASE_URL}/`;

  // ── Publish + audit (token fetch INSIDE try — M5) ─────────────────────────
  try {
    const token = await getValidAccessTokenForTeacher(admin, cls.teacher_id as string);

    const result = await publishToClassroom(admin, {
      token,
      schoolId: cls.school_id as string,
      classId,
      googleCourseId: cls.google_course_id as string,
      resourceType,
      resourceId,
      title,
      linkUrl,
      courseLinkUrl,
      maxPoints: resourceType === 'assignment' ? 100 : null,
      createdBy: user.id,
    });

    await logAudit(admin, {
      actorId: user.id,
      schoolId: cls.school_id as string,
      action: 'gc.publish',
      resourceType: 'google_publication',
      resourceId: result.google_coursework_id,
      metadata: {
        resource_type: resourceType,
        resource_id: resourceId,
        alreadyPublished: result.alreadyPublished,
        courseLinkPinned: result.courseLinkPinned,
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return gcErrorResponse(err);
  }
}
