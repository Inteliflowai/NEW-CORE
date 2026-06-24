// POST /api/teacher/google/import-roster — class upsert by (school_id, google_course_id) then the
// shared reconcile engine. RE-FETCHES the GC roster server-side (never trusts a client student
// list). Re-import updates the class NAME only — a teacher-edited subject/grade is preserved.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { reconcileCourseRoster } from '@/lib/google/reconcileCourseRoster';
import { gcErrorResponse } from '@/lib/google/errorEnvelope';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if ((profile?.role ?? null) !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const schoolId = profile?.school_id ?? null;
  if (!schoolId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { courseId?: string; name?: string; subject?: string; gradeLevel?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad Request' }, { status: 400 }); }
  const courseId = (body.courseId ?? '').trim();
  const name = (body.name ?? '').trim();
  if (!courseId || !name) return NextResponse.json({ error: 'courseId and name required' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  try {
    // Class upsert by (school_id, google_course_id). Re-import: update NAME only (preserve a
    // teacher-edited subject/grade). New: set subject/grade from the teacher-confirmed preview.
    const { data: existing, error: readErr } = await admin.from('classes').select('id, teacher_id').eq('school_id', schoolId).eq('google_course_id', courseId).maybeSingle();
    if (readErr) {
      console.error('[gc] class read failed:', readErr.message);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
    let classId: string;
    if (existing) {
      // IMP-6: this course is already imported. ONLY its teacher-of-record may re-import it — else
      // teacher B could re-point teacher A's class to B's Google token. Generic 403; engine not called.
      if (existing.teacher_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      classId = existing.id as string;
      const { error: updateErr } = await admin.from('classes').update({ name }).eq('id', classId);
      if (updateErr) console.error('[gc] class rename failed (non-fatal):', updateErr.message);
    } else {
      const { data: created, error: insErr } = await admin.from('classes').insert({
        name, subject: body.subject ?? null, grade_level: body.gradeLevel ?? null,
        teacher_id: user.id, school_id: schoolId, google_course_id: courseId, is_active: true,
      }).select('id').single();
      if (insErr) {
        // Handle concurrent first-import race: two simultaneous imports both see no existing row,
        // both attempt INSERT, and the loser gets Postgres unique-violation code 23505.
        if (insErr.code === '23505') {
          const { data: raced, error: reReadErr } = await admin.from('classes').select('id, teacher_id').eq('school_id', schoolId).eq('google_course_id', courseId).maybeSingle();
          if (reReadErr || !raced) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
          // IMP-6 on the now-found row: only its owner may proceed.
          if (raced.teacher_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
          classId = raced.id as string;
          const { error: updateErr } = await admin.from('classes').update({ name }).eq('id', classId);
          if (updateErr) console.error('[gc] class rename failed (non-fatal):', updateErr.message);
        } else {
          return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
      } else {
        if (!created) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        classId = created.id as string;
      }
    }

    const result = await reconcileCourseRoster(admin, { teacherId: user.id, schoolId, googleCourseId: courseId, classId });
    return NextResponse.json({ classId, ...result });
  } catch (err) {
    return gcErrorResponse(err);
  }
}
