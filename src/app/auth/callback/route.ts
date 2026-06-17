import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Validates that a redirect path is safe (relative, not absolute to another origin).
 * Rejects paths that:
 * - Start with '//' (protocol-relative, can point off-origin)
 * - Contain '://' (absolute URL)
 * - Contain backslashes (path traversal risk)
 * Only allows paths that start with '/' (relative to origin).
 */
function isSafeRedirectPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('://') && !path.includes('\\');
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/';

  // Validate the redirect path to prevent open redirects
  const next = isSafeRedirectPath(nextParam) ? nextParam : '/';

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
