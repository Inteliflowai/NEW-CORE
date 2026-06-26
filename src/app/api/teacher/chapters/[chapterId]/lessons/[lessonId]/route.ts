// DELETE /api/teacher/chapters/[chapterId]/lessons/[lessonId]
// Unassigns a lesson from a chapter by setting lessons.chapter_id = null.
//
// The lesson must belong to the same class as the chapter (the .eq('class_id', ...)
// on the UPDATE ensures the lesson can only be cleared if it belongs to this class).
//
// Auth chain: createServerSupabaseClient → auth.getUser() → STAFF_ROLES →
//   lookup chapter.class_id → guardClassAccess(class_id) → admin client writes.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

type Params = { params: Promise<{ chapterId: string; lessonId: string }> };

export async function DELETE(req: NextRequest, { params }: Params): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (!STAFF_ROLES.includes(profile?.role as typeof STAFF_ROLES[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { chapterId, lessonId } = await params;

  // ── Load chapter → get class_id ───────────────────────────────────────────
  const admin = createAdminSupabaseClient();
  const { data: chapter } = await admin
    .from('chapters')
    .select('class_id')
    .eq('id', chapterId)
    .maybeSingle();

  if (!chapter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const classId = (chapter as { class_id: string }).class_id;

  // ── IDOR guard ───────────────────────────────────────────────────────────────
  const denied = await guardClassAccess(classId);
  if (denied) return denied;

  // ── Clear chapter_id on the lesson (scoped to class_id for safety) ──────────
  // The .eq('class_id', classId) ensures we never clear a lesson from another class.
  const { error: updateError } = await admin
    .from('lessons')
    .update({ chapter_id: null })
    .eq('id', lessonId)
    .eq('class_id', classId);

  if (updateError) return NextResponse.json({ error: 'Internal error' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
