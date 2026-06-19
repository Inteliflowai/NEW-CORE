import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { homeForRole } from '@/lib/auth/roleHome';

// Public at the proxy level (request proceeds). NOTE: /set-password is "public"
// here but the PAGE guards itself via getSession (Task 7). /logout signs out.
const PUBLIC_PREFIXES = ['/login', '/set-password', '/logout', '/auth', '/trial-expired'];
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

  if (user && (pathname === '/' || pathname === '/login')) {
    const { data: profile } = await supabase
      .from('users').select('role').eq('id', user.id).single();
    const home = homeForRole(profile?.role ?? null);
    // Guard against a redirect loop: a role-less authed user resolves to /login;
    // if home equals the path we're already on, fall through and render it.
    if (home !== pathname) return redirectTo(home);
  }
  if (!user && pathname === '/') return redirectTo('/login');
  if (!user && !isPublic(pathname)) return redirectTo('/login', '?expired=true');

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
