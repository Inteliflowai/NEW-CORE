import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';

function isSafeRedirectPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('://') && !path.includes('\\');
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const nextParam = searchParams.get('next') ?? '/';
  const next = isSafeRedirectPath(nextParam) ? nextParam : '/';

  // Recovery / magic-link / email-confirm via token_hash.
  if (tokenHash && type) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    // `next` is recovery's /set-password, else `/`. We deliberately do NOT
    // role-fetch here: `/` is resolved to the role home by proxy.ts (single
    // source of role routing), and any crafted-but-safe internal `next` is
    // re-checked by that route's server-layout guard — so no role leak.
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=reset_expired`);
  }

  // OAuth / magic-link PKCE exchange.
  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
