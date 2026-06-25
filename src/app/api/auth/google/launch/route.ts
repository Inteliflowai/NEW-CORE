// src/app/api/auth/google/launch/route.ts
// GET /api/auth/google/launch?gc=<quiz|assignment>&id=<id>[&interactive=1]
// The silent-SSO initiator for the PUBLIC Open-CORE Classroom link (GC Seg 4). Sets a one-time
// nonce cookie and redirects to Google's consent with a signed launch state. Public (no CORE
// session yet — see PUBLIC_PREFIXES). Identity is established only by Google in the callback.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { signLaunchState, NONCE_COOKIE_NAME, type LaunchGc } from '@/lib/google/launchState';
import { buildLaunchAuthUrl } from '@/lib/google/oauthUrls';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(req.url);
  const gc = (searchParams.get('gc') ?? '').trim();
  const id = (searchParams.get('id') ?? '').trim();
  const interactive = searchParams.get('interactive') === '1';

  // Shape-only validation (identity/ownership is enforced post-Google). Bad link → normal login.
  if ((gc !== 'quiz' && gc !== 'assignment') || !id) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const nonce = randomUUID();
  const mode: 'silent' | 'interactive' = interactive ? 'interactive' : 'silent';
  let state: string;
  try {
    state = signLaunchState({ gc: gc as LaunchGc, id, nonce, mode });
  } catch {
    // GOOGLE_LAUNCH_STATE_SECRET unset → can't sign → fall back to login (observable).
    return NextResponse.redirect(`${origin}/login?error=launch`);
  }

  const res = NextResponse.redirect(buildLaunchAuthUrl(state, mode));
  // __Host- prefix in prod (Secure mandatory there) + sibling-subdomain shadow protection (M1).
  res.cookies.set(NONCE_COOKIE_NAME, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}
