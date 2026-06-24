// GET /api/teacher/google/connect — start the per-teacher Google OAuth consent.
// Sets a CSRF state cookie (verified by the callback) and redirects to Google.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { buildConnectAuthUrl } from '@/lib/google/oauthUrls';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (role !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const state = randomUUID();
  const res = NextResponse.redirect(buildConnectAuthUrl(state));
  res.cookies.set('g_oauth_state', state, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600,
  });
  return res;
}
