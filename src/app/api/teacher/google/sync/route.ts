// POST /api/teacher/google/sync — on-demand "Sync now" for one already-imported GC-mirrored class.
// Accessible to any STAFF_ROLES caller (teacher, school_admin, school_sysadmin, platform_admin).
// guardClassAccess gates the specific class by id — permits the owning teacher OR a same-school admin
// OR platform admin; the reconcile always runs as the class's teacher-of-record (the per-teacher
// Google grant owns the course). connect/courses/roster/import-roster stay teacher-only.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { reconcileCourseRoster } from '@/lib/google/reconcileCourseRoster';
import { gcErrorResponse } from '@/lib/google/errorEnvelope';
import { logAudit } from '@/lib/audit/logAudit';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if (!STAFF_ROLES.includes(profile?.role as typeof STAFF_ROLES[number])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { classId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad Request' }, { status: 400 }); }
  const classId = (body.classId ?? '').trim();
  if (!classId) return NextResponse.json({ error: 'classId required' }, { status: 400 });

  // REAL guardClassAccess contract (src/lib/auth/guards.ts:68): Promise<NextResponse | null> —
  // null = proceed, a NextResponse = deny (already 401/403; 403-not-404 on a missing class).
  const denied = await guardClassAccess(classId);
  if (denied) return denied;

  const admin = createAdminSupabaseClient();
  const { data: cls } = await admin.from('classes').select('id, teacher_id, school_id, google_course_id').eq('id', classId).maybeSingle();
  if (!cls) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!cls.google_course_id) return NextResponse.json({ error: 'Not a Google-mirrored class' }, { status: 400 });

  try {
    const result = await reconcileCourseRoster(admin, {
      teacherId: cls.teacher_id as string, schoolId: cls.school_id as string,
      googleCourseId: cls.google_course_id as string, classId,
    });
    if (result.softRemoved + result.reactivated + result.enrolled > 0 || result.skippedOther > 0 || result.errors > 0) {
      await logAudit(admin, {
        actorId: user.id,
        schoolId: cls.school_id as string,
        action: 'roster.sync',
        resourceType: 'class',
        resourceId: classId,
        metadata: { enrolled: result.enrolled, reactivated: result.reactivated, softRemoved: result.softRemoved, skippedOther: result.skippedOther, errors: result.errors, source: 'google' },
      });
    }
    return NextResponse.json({ classId, ...result });
  } catch (err) {
    return gcErrorResponse(err);
  }
}
