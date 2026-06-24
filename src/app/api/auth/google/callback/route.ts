// GET /api/auth/google/callback — the single registered Google redirect URI.
// Verifies CSRF state, requires the current logged-in staff user, exchanges the code, fetches the
// Google profile, and stores the ENCRYPTED connection for that teacher. Never creates a session.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { exchangeCodeForTokens, storeConnection } from '@/lib/google/tokens';
import { getGoogleProfile } from '@/lib/google/profile';

function back(origin: string, qs: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/settings/google?${qs}`);
  res.cookies.delete('g_oauth_state');
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const cookieState = req.cookies.get('g_oauth_state')?.value ?? null;

  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (role !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const oauthError = searchParams.get('error');
  if (oauthError) return back(origin, 'error=denied');   // user cancelled consent (Google ?error=, no code)

  if (!code || !state || !cookieState || state !== cookieState) return back(origin, 'error=state');

  try {
    const tokens = await exchangeCodeForTokens(code);
    const gp = await getGoogleProfile(tokens.access_token);
    const admin = createAdminSupabaseClient();
    await storeConnection(admin, {
      userId: user.id, schoolId: profile?.school_id ?? null,
      googleId: gp.id, email: gp.email, tokens,
    });
    return back(origin, 'connected=1');
  } catch {
    return back(origin, 'error=exchange');
  }
}
