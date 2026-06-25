// GET /api/auth/google/callback — the single registered Google redirect URI, shared by two flows:
//  • teacher connect (Seg 1): CSRF cookie + getUser + role; stores the encrypted token vault.
//  • student silent-SSO launch (Seg 4): branch on a `launch:`-prefixed HMAC-signed state; verifies
//    the state + one-time nonce, establishes identity from Google's verified profile, maps via
//    external_identities, mints a Supabase session, and deep-links. Never creates an account.
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { exchangeCodeForTokens, storeConnection } from '@/lib/google/tokens';
import { getGoogleProfile, type GoogleProfile } from '@/lib/google/profile';
import { verifyLaunchState, safeStudentDest, LAUNCH_STATE_PREFIX, NONCE_COOKIE_NAME } from '@/lib/google/launchState';
import { deriveResourceSchool, resolveGcDeepLink } from '@/lib/google/launchResolve';
import { resolveExternalIdentity } from '@/lib/google/resolveExternalIdentity';

export const runtime = 'nodejs';

function back(origin: string, qs: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/settings/google?${qs}`);
  res.cookies.delete('g_oauth_state');
  return res;
}

// Every launch-branch exit clears the one-time nonce (session cookies from verifyOtp ride along
// via next/headers, as proven by the live /auth/callback route).
function launchExit(origin: string, path: string): NextResponse {
  const res = NextResponse.redirect(`${origin}${path}`);
  // Clear the one-time nonce with the SAME attributes the initiator set — a bare delete() omits
  // Secure/Path, and a __Host--prefixed deletion without Secure+Path=/ is rejected by the browser
  // (the cookie would otherwise survive its full maxAge). (whole-branch review)
  res.cookies.set(NONCE_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return res;
}

function nonceMatches(cookieVal: string | undefined, stateNonce: string): boolean {
  if (!cookieVal) return false;
  const a = Buffer.from(cookieVal);
  const b = Buffer.from(stateNonce);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleLaunch(req: NextRequest, origin: string, state: string): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);

    const payload = verifyLaunchState(state);
    if (!payload) return launchExit(origin, '/login?error=launch');

    // One-time nonce: replay/CSRF protection (the cookie was set by the initiator).
    if (!nonceMatches(req.cookies.get(NONCE_COOKIE_NAME)?.value, payload.nonce)) {
      return launchExit(origin, '/login?error=launch');
    }

    // Google silent-auth failure → exactly one interactive retry, then give up.
    const gErr = searchParams.get('error');
    if (gErr) {
      if (payload.mode === 'silent') {
        return launchExit(
          origin,
          `/api/auth/google/launch?gc=${encodeURIComponent(payload.gc)}&id=${encodeURIComponent(payload.id)}&interactive=1`,
        );
      }
      return launchExit(origin, '/login?error=google');
    }

    const code = searchParams.get('code');
    if (!code) return launchExit(origin, '/login?error=google');

    let profile: GoogleProfile;
    try {
      const tokens = await exchangeCodeForTokens(code);
      profile = await getGoogleProfile(tokens.access_token);
    } catch {
      return launchExit(origin, '/login?error=google');
    }
    if (!profile.verified_email) return launchExit(origin, '/launch/unmatched');

    const admin = createAdminSupabaseClient();

    // Scope identity resolution to the class + school that own the launched resource.
    const resource = await deriveResourceSchool(admin, payload.gc, payload.id);
    if (!resource) return launchExit(origin, '/launch/unmatched');

    const studentId = await resolveExternalIdentity(admin, {
      schoolId: resource.schoolId, provider: 'google', externalId: profile.id, email: profile.email,
    });
    if (!studentId) return launchExit(origin, '/launch/unmatched');

    // Defense-in-depth: only mint a session for an actual student.
    const { data: u } = await admin.from('users').select('email, role').eq('id', studentId).maybeSingle();
    const email = (u as { email?: string } | null)?.email;
    const role = (u as { role?: string } | null)?.role;
    if (!email || role !== 'student') return launchExit(origin, '/launch/unmatched');

    // Four-audience (M2, spec §6): the resolved student must be ACTIVELY enrolled in the launched
    // resource's class. Closes stale-link re-entry for a soft-unenrolled (is_active=false) student
    // whose users row + external_identity still exist.
    const { data: enr } = await admin
      .from('enrollments')
      .select('id')
      .eq('student_id', studentId)
      .eq('class_id', resource.classId)
      .eq('is_active', true)
      .maybeSingle();
    if (!enr) return launchExit(origin, '/launch/unmatched');

    // Mint a real Supabase session (passwordless) — V1's mechanism; mirrors /auth/callback.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const tokenHash = (link as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
    if (linkErr || !tokenHash) return launchExit(origin, '/login?error=session');

    const supabase = await createServerSupabaseClient();
    const { error: otpErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
    if (otpErr) return launchExit(origin, '/login?error=session');

    const dest = safeStudentDest(await resolveGcDeepLink(admin, { studentId, gc: payload.gc, id: payload.id }));
    return launchExit(origin, dest);
  } catch {
    return launchExit(origin, '/login?error=launch');
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(req.url);
  const state = searchParams.get('state');

  // Branch: student silent-SSO launch (HMAC-signed `launch:` state) vs teacher connect (CSRF
  // cookie). The teacher path below is unchanged.
  if (state && state.startsWith(LAUNCH_STATE_PREFIX)) {
    return handleLaunch(req, origin, state);
  }

  const code = searchParams.get('code');
  const cookieState = req.cookies.get('g_oauth_state')?.value ?? null;

  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    res.cookies.delete('g_oauth_state');
    return res;
  }
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (role !== 'teacher') {
    const res = NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    res.cookies.delete('g_oauth_state');
    return res;
  }

  // CSRF first: every callback (success OR Google ?error=) carries state + the cookie.
  if (!state || !cookieState || state !== cookieState) return back(origin, 'error=state');

  const oauthError = searchParams.get('error');
  if (oauthError) return back(origin, 'error=denied');   // user cancelled consent (valid state, no code)

  if (!code) return back(origin, 'error=state');

  try {
    const tokens = await exchangeCodeForTokens(code);
    const gp = await getGoogleProfile(tokens.access_token);
    if (!gp.verified_email) return back(origin, 'error=unverified');
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
