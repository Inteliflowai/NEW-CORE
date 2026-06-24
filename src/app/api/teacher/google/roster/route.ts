// GET /api/teacher/google/roster?courseId=… — the GC roster for a course (paginated) annotated
// with existsInCore for the review-only preview. The teacherId=me GC filter + the teacher's own
// token IS the access boundary (no CORE class row exists yet for a not-yet-imported course).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { getValidAccessTokenForTeacher, GoogleNotConnectedError } from '@/lib/google/tokens';
import { listCourseStudents, GoogleScopeError } from '@/lib/google/classroom';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if ((profile?.role ?? null) !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const courseId = new URL(req.url).searchParams.get('courseId');
  if (!courseId) return NextResponse.json({ error: 'courseId required' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  try {
    const accessToken = await getValidAccessTokenForTeacher(admin, user.id);
    const { students } = await listCourseStudents(accessToken, courseId);   // {students, complete}; preview ignores `complete`

    const emails = students.map((s) => s.email).filter(Boolean);
    const existing = new Set<string>();
    if (emails.length && profile?.school_id) {
      const { data } = await admin.from('users').select('email').eq('school_id', profile.school_id).eq('role', 'student').in('email', emails);
      for (const row of (data as Array<{ email: string }> | null) ?? []) existing.add(row.email.toLowerCase());
    }
    return NextResponse.json({ students: students.map((s) => ({ ...s, existsInCore: existing.has(s.email) })) });
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false });
    if (err instanceof GoogleScopeError) return NextResponse.json({ connected: true, needsReconnect: true });
    console.error('[gc] roster fetch failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
