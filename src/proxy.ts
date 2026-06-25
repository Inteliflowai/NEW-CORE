import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { homeForRole } from '@/lib/auth/roleHome';

// Public at the proxy level (request proceeds). NOTE: /set-password is "public"
// here but the PAGE guards itself via getSession (Task 7). /logout signs out.
const PUBLIC_PREFIXES = ['/login', '/set-password', '/logout', '/auth', '/trial-expired', '/api/auth/google/launch', '/launch/unmatched'];
function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: use getUser() not getSession() — and do not run code between
  // createServerClient and getUser().
  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // Build a redirect that carries the refreshed cookies (so the session survives).
  const redirectTo = (path: string, search = '') => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = search;
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  // The Seg-4 Open-CORE deep-link: /?gc=<quiz|assignment>&id=<id>.
  const gc = request.nextUrl.searchParams.get('gc');
  const gcId = request.nextUrl.searchParams.get('id');
  const isGcLink = (gc === 'quiz' || gc === 'assignment') && !!gcId;

  if (user && (pathname === '/' || pathname === '/login')) {
    // An authenticated student's ?gc= deep-link is handled by page.tsx (not role-home).
    if (pathname === '/' && isGcLink) return supabaseResponse;
    const { data: profile } = await supabase
      .from('users').select('role').eq('id', user.id).single();
    const home = homeForRole(profile?.role ?? null);
    // Guard against a redirect loop: a role-less authed user resolves to /login.
    if (home !== pathname) return redirectTo(home);
  }

  // Unauthenticated Open-CORE link → the silent-SSO initiator (not /login).
  if (!user && pathname === '/' && isGcLink) {
    return redirectTo('/api/auth/google/launch', `?gc=${encodeURIComponent(gc!)}&id=${encodeURIComponent(gcId!)}`);
  }
  if (!user && pathname === '/') return redirectTo('/login');
  if (!user && !isPublic(pathname)) {
    // The launch callback: Google redirects here with NO CORE session. Let it through ONLY when it
    // carries a signed launch state (the handler HMAC-verifies). The callback stays gated for the
    // teacher path.
    if (
      pathname === '/api/auth/google/callback' &&
      request.nextUrl.searchParams.get('state')?.startsWith('launch:')
    ) {
      return supabaseResponse;
    }
    return redirectTo('/login', '?expired=true');
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
