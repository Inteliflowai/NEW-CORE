// GET  /api/teacher/chapters?classId=<id>   — list active chapters for a class
// POST /api/teacher/chapters                — create a new chapter
//
// Auth chain (both): createServerSupabaseClient → auth.getUser() → STAFF_ROLES →
//   guardClassAccess(classId) → createAdminSupabaseClient().
// RLS is NOT the IDOR backstop; guardClassAccess is.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

// ── Shared auth prologue ───────────────────────────────────────────────────────
async function authPrologue(): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; userId: string }
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
  return { ok: true, userId: user.id };
}

// ── GET /api/teacher/chapters?classId=<id> ────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authPrologue();
  if (!auth.ok) return auth.response;

  const classId = (req.nextUrl.searchParams.get('classId') ?? '').trim();
  if (!classId) return NextResponse.json({ error: 'classId required' }, { status: 400 });

  const denied = await guardClassAccess(classId);
  if (denied) return denied;

  const admin = createAdminSupabaseClient();

  const { data: chapters, error } = await admin
    .from('chapters')
    .select('id, class_id, title, description, sequence, created_at, archived_at')
    .eq('class_id', classId)
    .is('archived_at', null)
    .order('sequence');

  if (error) return NextResponse.json({ error: 'Internal error' }, { status: 500 });

  // Attach lesson_count per chapter via a separate aggregate query
  const chapterIds = ((chapters ?? []) as Array<{ id: string }>).map((c) => c.id);
  let lessonCounts: Record<string, number> = {};

  if (chapterIds.length > 0) {
    const { data: lessonRows } = await admin
      .from('lessons')
      .select('chapter_id')
      .in('chapter_id', chapterIds);
    for (const l of ((lessonRows ?? []) as Array<{ chapter_id: string }>)) {
      lessonCounts[l.chapter_id] = (lessonCounts[l.chapter_id] ?? 0) + 1;
    }
  }

  type ChapterSelectRow = {
    id: string;
    class_id: string;
    title: string;
    description: string | null;
    sequence: number;
    created_at: string;
    archived_at: string | null;
  };

  const result = ((chapters ?? []) as ChapterSelectRow[]).map((c) => ({
    ...c,
    lesson_count: lessonCounts[c.id] ?? 0,
  }));

  return NextResponse.json({ chapters: result });
}

// ── POST /api/teacher/chapters ────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authPrologue();
  if (!auth.ok) return auth.response;

  let body: { classId?: string; title?: string; description?: string; sequence?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const classId = (body.classId ?? '').trim();
  const title = (body.title ?? '').trim();

  if (!classId) return NextResponse.json({ error: 'classId required' }, { status: 400 });
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

  const denied = await guardClassAccess(classId);
  if (denied) return denied;

  const admin = createAdminSupabaseClient();

  const { data: chapter, error } = await admin
    .from('chapters')
    .insert({
      class_id: classId,
      teacher_id: auth.userId,
      title,
      description: body.description?.trim() || null,
      sequence: body.sequence ?? 0,
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: 'Internal error' }, { status: 500 });

  return NextResponse.json({ chapter_id: (chapter as { id: string }).id }, { status: 201 });
}
