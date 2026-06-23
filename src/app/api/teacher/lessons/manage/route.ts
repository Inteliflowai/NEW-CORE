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
import { GeneratedLessonSchema } from '@/lib/engine/types';

type Body = {
  lesson_id?: string;
  action?: 'archive' | 'edit';
  title?: string;
  subject?: string | null;
  grade_level?: string | null;
  parsed_content?: unknown;
  standard_codes?: unknown;
  standard_framework?: string | null;
};
const ACTIONS = new Set(['archive', 'edit']);

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

    if (body.action === 'edit') {
      const patch: Record<string, unknown> = {};
      if (typeof body.title === 'string') patch.title = body.title;
      if ('subject' in body) patch.subject = body.subject ?? null;
      if ('grade_level' in body) patch.grade_level = body.grade_level ?? null;
      if (body.parsed_content && typeof body.parsed_content === 'object') {
        // Validate the lesson content against the generated-lesson contract — quizzes/generate
        // later feeds parsed_content to the LLM, so an unchecked shape is an injection/garbage risk.
        const v = GeneratedLessonSchema.safeParse(body.parsed_content);
        if (!v.success) return NextResponse.json({ error: 'Invalid lesson content' }, { status: 400 });
        patch.parsed_content = v.data;
      }
      if (Array.isArray(body.standard_codes)) {
        patch.standard_codes = (body.standard_codes as unknown[]).filter((c): c is string => typeof c === 'string');
      }
      if ('standard_framework' in body) patch.standard_framework = body.standard_framework ?? null;
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

      const { error } = await admin.from('lessons').update(patch).eq('id', lesson.id);
      if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
      return NextResponse.json({ ok: true, lesson_id: lesson.id, status: lesson.status });
    }

    // archive — soft delete.
    const { error } = await admin.from('lessons').update({ status: 'archived' }).eq('id', lesson.id);
    if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
    return NextResponse.json({ ok: true, lesson_id: lesson.id, status: 'archived' });
  } catch (err) {
    console.error('[lessons/manage] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
