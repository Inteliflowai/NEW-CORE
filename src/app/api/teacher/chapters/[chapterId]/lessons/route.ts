// POST /api/teacher/chapters/[chapterId]/lessons
// Assigns one or more lessons to a chapter by setting lessons.chapter_id.
//
// Body: { lessonIds: string[] }
//
// C1 — Scope guard: each lesson's class_id MUST match the chapter's class_id.
//   Lessons from a different class are silently filtered out. If none remain
//   after filtering, return 403 (IDOR attempt with no valid targets).
//
// 409 when the chapter is archived — cannot assign lessons to an archived chapter.
//
// Auth chain: createServerSupabaseClient → auth.getUser() → STAFF_ROLES →
//   lookup chapter.class_id → guardClassAccess(class_id) → admin client writes.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

type Params = { params: Promise<{ chapterId: string }> };

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
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

  const { chapterId } = await params;

  // ── Load chapter → get class_id + archived check ────────────────────────────
  const admin = createAdminSupabaseClient();
  const { data: chapter } = await admin
    .from('chapters')
    .select('class_id, archived_at')
    .eq('id', chapterId)
    .maybeSingle();

  if (!chapter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const chapterData = chapter as { class_id: string; archived_at: string | null };
  if (chapterData.archived_at) {
    return NextResponse.json({ error: 'Chapter is archived' }, { status: 409 });
  }

  const classId = chapterData.class_id;

  // ── IDOR guard ───────────────────────────────────────────────────────────────
  const denied = await guardClassAccess(classId);
  if (denied) return denied;

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: { lessonIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const lessonIds = body.lessonIds ?? [];
  if (!Array.isArray(lessonIds) || lessonIds.length === 0) {
    return NextResponse.json({ error: 'lessonIds required (non-empty array)' }, { status: 400 });
  }

  // ── C1: Verify each lesson belongs to the same class (scope guard) ──────────
  const { data: lessons } = await admin
    .from('lessons')
    .select('id, class_id')
    .in('id', lessonIds);

  const validIds = ((lessons ?? []) as Array<{ id: string; class_id: string }>)
    .filter((l) => l.class_id === classId)
    .map((l) => l.id);

  if (validIds.length === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Assign lessons → chapter ─────────────────────────────────────────────────
  const { error: updateError } = await admin
    .from('lessons')
    .update({ chapter_id: chapterId })
    .in('id', validIds);

  if (updateError) return NextResponse.json({ error: 'Internal error' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
