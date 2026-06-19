import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

async function handle(request: Request) {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  // 303 See Other: a POST form submit becomes a GET of /login (a 307 would re-POST).
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
export const POST = handle;
