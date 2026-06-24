// POST /api/teacher/google/disconnect — remove the caller's own stored Google connection.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (role !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from('google_connections').delete().eq('user_id', user.id);
  if (error) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
