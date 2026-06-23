// src/app/api/attempts/homework-draft/route.ts
// Assignment autosave — PUT upserts the in-progress draft, GET reads it back.
// Reuses the in-progress homework_attempts row provisioned by loadAssignmentForPlay.
// Auth chain on every call: server client → getUser() → admin client (bypasses RLS)
// → object-level ownership guard (student_id match) — RLS is NOT the IDOR backstop.
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { responsesImageUrlsOk } from '@/lib/assignments/imageUrlGuard';
type ResponsesShape = { tasks: Record<string, { text: string; image_url: string | null }> };

async function owned(admin: ReturnType<typeof createAdminSupabaseClient>, attemptId: string, userId: string) {
  const { data } = await admin.from('homework_attempts').select('id, student_id, status').eq('id', attemptId).eq('student_id', userId).maybeSingle();
  return data as { id: string; student_id: string; status: string } | null;
}
export async function PUT(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let p: { attempt_id?: string; responses?: ResponsesShape };
  try { p = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  if (!p.attempt_id || !p.responses) return NextResponse.json({ error: 'Missing attempt_id or responses' }, { status: 400 });
  const admin = createAdminSupabaseClient();
  const att = await owned(admin, p.attempt_id, user.id);
  if (!att) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
  if (att.status !== 'in_progress') return NextResponse.json({ error: 'Attempt not editable' }, { status: 409 });
  if (!responsesImageUrlsOk(p.responses, user.id)) return NextResponse.json({ error: 'Invalid image reference' }, { status: 400 });
  const { error } = await admin.from('homework_attempts').update({ responses: p.responses }).eq('id', p.attempt_id).eq('student_id', user.id);
  if (error) return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
export async function GET(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const attemptId = new URL(req.url).searchParams.get('attempt_id');
  if (!attemptId) return NextResponse.json({ error: 'Missing attempt_id' }, { status: 400 });
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from('homework_attempts').select('responses').eq('id', attemptId).eq('student_id', user.id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
  return NextResponse.json({ responses: (data as { responses: ResponsesShape | null }).responses });
}
