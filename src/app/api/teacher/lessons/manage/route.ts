// src/app/api/teacher/lessons/manage/route.ts
// POST — teacher/admin lesson lifecycle: archive (soft delete).
// Auth chain re-checked server-side (the client cannot be trusted):
//   getUser → role ∈ STAFF_ROLES → resolve lesson → its class_id → guardClassAccess
//   (the ONLY IDOR backstop — RLS does not protect admin reads). Mirrors quizzes/manage.
//
// archive = status='archived' (soft delete; NO archived_at column in V2). Used by the
//           Upload Studio to clean up a just-created near-duplicate lesson when the teacher
//           declines the fuzzy-dup ("Cancel" / "Use that one") so it does not pollute future
//           dedup as an orphan draft.
//
// Fail loud on any write error — never return 200 on a silent write failure.
// All user-facing strings here are internal/operator-facing error envelopes (DRAFT → Barb);
// the client masks them with its own captured copy.
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

type Body = {
  lesson_id?: string;
  action?: 'archive';
};
const ACTIONS = new Set(['archive']);

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: Body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || !body.lesson_id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    if (!body.action || !ACTIONS.has(body.action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
    const role = (roleRow as { role?: string } | null)?.role;
    if (!role || !new Set<string>(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Resolve the lesson → its class_id, then the IDOR guard. RLS is NOT the backstop on admin reads.
    const { data: lessonRow } = await admin.from('lessons')
      .select('id, class_id, status').eq('id', body.lesson_id).maybeSingle();
    const lesson = lessonRow as { id: string; class_id: string | null; status: string } | null;
    if (!lesson) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });

    const guard = await guardClassAccess(lesson.class_id ?? '');
    if (guard) return guard;

    // archive — soft delete.
    const { error } = await admin.from('lessons').update({ status: 'archived' }).eq('id', lesson.id);
    if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
    return NextResponse.json({ ok: true, lesson_id: lesson.id, status: 'archived' });
  } catch (err) {
    console.error('[lessons/manage] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
