// GET /api/teacher/google/courses — the connected teacher's active GC courses (paginated).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { getValidAccessTokenForTeacher, GoogleNotConnectedError } from '@/lib/google/tokens';
import { listCourses, GoogleScopeError } from '@/lib/google/classroom';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if ((profile?.role ?? null) !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  try {
    const accessToken = await getValidAccessTokenForTeacher(admin, user.id);
    const courses = await listCourses(accessToken);
    return NextResponse.json({ courses });
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false });
    if (err instanceof GoogleScopeError) return NextResponse.json({ connected: true, needsReconnect: true });
    console.error('[gc] courses list failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
