// src/app/api/profile/route.ts — update the caller's OWN display name (users.full_name).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { full_name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const fullName = (body.full_name ?? '').trim();
  if (!fullName) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (fullName.length > 120) return NextResponse.json({ error: 'Name is too long.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from('users').update({ full_name: fullName }).eq('id', user.id);
  if (error) return NextResponse.json({ error: 'Could not save — try again.' }, { status: 500 });
  return NextResponse.json({ ok: true, full_name: fullName });
}
