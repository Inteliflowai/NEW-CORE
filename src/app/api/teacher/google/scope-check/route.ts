// GET /api/teacher/google/scope-check — is this teacher connected, and do they still hold the
// scopes CORE needs? Refreshes the token if needed, reads live scopes from tokeninfo, diffs.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { getValidAccessTokenForTeacher, GoogleNotConnectedError } from '@/lib/google/tokens';
import { GC_REQUIRED_SCOPES } from '@/lib/google/config';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (role !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  let accessToken: string;
  try {
    accessToken = await getValidAccessTokenForTeacher(admin, user.id);
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false, needsReconnect: false, missing: [] });
    return NextResponse.json({ connected: false, needsReconnect: true, missing: [] });
  }

  const diff = (scopes: Iterable<string>) => {
    const live = new Set(scopes);
    const missing = GC_REQUIRED_SCOPES.filter((s) => !live.has(s));
    return NextResponse.json({ connected: true, needsReconnect: missing.length > 0, missing });
  };
  try {
    // Access token in the tokeninfo query string is a conscious V1-parity exception to Constraint
    // D4's never-logged posture: the call is server-to-Google only and CORE never logs it.
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    if (res.ok) {
      const info = (await res.json()) as { scope?: string };
      return diff((info.scope ?? '').split(' '));
    }
  } catch { /* fall through to the stored-scopes fallback below */ }
  // tokeninfo unavailable (non-200 / network / sunset): fall back to last-known granted_scopes from
  // connect — avoids a false reconnect-storm for fully-authorized teachers if tokeninfo changes.
  const { data: conn } = await admin.from('google_connections').select('granted_scopes').eq('user_id', user.id).maybeSingle();
  return diff((conn?.granted_scopes ?? []) as string[]);
}
