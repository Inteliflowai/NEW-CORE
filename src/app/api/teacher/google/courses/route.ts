// GET /api/teacher/google/courses — the connected teacher's active GC courses (paginated).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { getValidAccessTokenForTeacher } from '@/lib/google/tokens';
import { listCourses } from '@/lib/google/classroom';
import { gcErrorResponse } from '@/lib/google/errorEnvelope';

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
    return gcErrorResponse(err);
  }
}
