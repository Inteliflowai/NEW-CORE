// PATCH  /api/teacher/chapters/[chapterId] — update title/description/sequence
// DELETE /api/teacher/chapters/[chapterId] — soft archive (sets archived_at = now())
//
// Auth chain (both): createServerSupabaseClient → auth.getUser() → STAFF_ROLES →
//   lookup chapter.class_id → guardClassAccess(class_id) → admin client writes.
// RLS is NOT the IDOR backstop; guardClassAccess is.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

type Params = { params: Promise<{ chapterId: string }> };

// ── Shared auth + IDOR resolution ─────────────────────────────────────────────
async function resolveChapter(chapterId: string): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; classId: string }
> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (!STAFF_ROLES.includes(profile?.role as typeof STAFF_ROLES[number])) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  // Load the chapter to get its class_id (IDOR resolution)
  const admin = createAdminSupabaseClient();
  const { data: chapter } = await admin
    .from('chapters')
    .select('class_id')
    .eq('id', chapterId)
    .maybeSingle();

  if (!chapter) {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }

  const classId = (chapter as { class_id: string }).class_id;
  const denied = await guardClassAccess(classId);
  if (denied) return { ok: false, response: denied };

  return { ok: true, classId };
}

// ── PATCH /api/teacher/chapters/[chapterId] ───────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { chapterId } = await params;
  const resolved = await resolveChapter(chapterId);
  if (!resolved.ok) return resolved.response;

  let body: { title?: string; description?: string; sequence?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  // Build update payload — at least one field must be set
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = (body.title as string).trim();
  if (body.description !== undefined) patch.description = body.description?.trim() || null;
  if (body.sequence !== undefined) patch.sequence = body.sequence;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from('chapters')
    .update(patch)
    .eq('id', chapterId);

  if (error) return NextResponse.json({ error: 'Internal error' }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// ── DELETE /api/teacher/chapters/[chapterId] — soft archive ───────────────────
export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { chapterId } = await params;
  const resolved = await resolveChapter(chapterId);
  if (!resolved.ok) return resolved.response;

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from('chapters')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', chapterId);

  if (error) return NextResponse.json({ error: 'Internal error' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
