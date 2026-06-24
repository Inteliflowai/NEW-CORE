// POST /api/teacher/google/sync — on-demand "Sync now" for one already-imported GC-mirrored class.
// guardClassAccess gates the class by id; the reconcile runs as the class's teacher-of-record
// (the per-teacher Google grant owns the course), even if a same-school admin triggers it.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { reconcileCourseRoster } from '@/lib/google/reconcileCourseRoster';
import { GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if ((profile?.role ?? null) !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
    return NextResponse.json({ classId, ...result });
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false });
    if (err instanceof GoogleScopeError) return NextResponse.json({ connected: true, needsReconnect: true });
    console.error('[gc] sync failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
