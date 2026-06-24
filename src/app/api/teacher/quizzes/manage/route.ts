// src/app/api/teacher/quizzes/manage/route.ts
// POST — teacher/admin quiz lifecycle: edit / publish / unpublish / archive.
// Auth chain re-checked server-side (the client cannot be trusted):
//   getUser → role ∈ STAFF_ROLES → resolve quiz → its class_id → guardClassAccess
//   (the ONLY IDOR backstop — RLS does not protect admin reads). Mirrors the
//   gradebook override route.
//
// publish   = status='published' + published_at=now() — the STUDENT-VISIBILITY GATE
//             (a quiz is student-visible only at status='published' with published_at).
// unpublish = status='draft' + published_at=null (pull it back from students).
// archive   = status='archived' (soft delete; NO archived_at column in V2).
// edit      = update the quiz title + per-question text/choices/rubric. NO engine re-run,
//             and it never touches status/published_at (publishing is a separate action).
//
// Fail loud on any write error — never return 200 on a silent write failure.
// All user-facing strings here are operator-facing error envelopes (DRAFT → Barb).
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

type QuestionPatch = {
  id?: string;
  question_text?: string;
  choices?: unknown;
  rubric?: string | null;
};
type Body = {
  quiz_id?: string;
  action?: 'publish' | 'unpublish' | 'archive' | 'edit';
  title?: string;
  questions?: QuestionPatch[];
};
const ACTIONS = new Set(['publish', 'unpublish', 'archive', 'edit']);
const MAX_TITLE = 300;
const MAX_QUESTION_TEXT = 4000;
const MAX_RUBRIC = 4000;

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: Body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || !body.quiz_id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    if (!body.action || !ACTIONS.has(body.action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
    const role = (roleRow as { role?: string } | null)?.role;
    if (!role || !new Set<string>(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Resolve the quiz → its class_id, then the IDOR guard. RLS is NOT the backstop on admin reads.
    const { data: quizRow } = await admin.from('quizzes')
      .select('id, class_id, status, published_at').eq('id', body.quiz_id).maybeSingle();
    const quiz = quizRow as { id: string; class_id: string; status: string; published_at: string | null } | null;
    if (!quiz) return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });

    const guard = await guardClassAccess(quiz.class_id);
    if (guard) return guard;

    if (body.action === 'publish') {
      // Never publish a question-less quiz to students. Since quiz generation is now
      // backgrounded (the quiz row exists before its questions), a 0-question quiz is
      // "still building" — block publish server-side, not just in the UI (a stale client
      // or a direct call must not reach students with an empty quiz).
      const { count, error: countErr } = await admin.from('quiz_questions')
        .select('id', { count: 'exact', head: true }).eq('quiz_id', quiz.id);
      if (countErr) return NextResponse.json({ error: 'Server error' }, { status: 500 });
      if (!count || count === 0) return NextResponse.json({ error: 'quiz_not_ready' }, { status: 409 });
      const patch = { status: 'published', published_at: new Date().toISOString() };
      const { error } = await admin.from('quizzes').update(patch).eq('id', quiz.id);
      if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
      return NextResponse.json({ ok: true, quiz_id: quiz.id, status: 'published', published_at: patch.published_at });
    }

    if (body.action === 'unpublish') {
      const { error } = await admin.from('quizzes').update({ status: 'draft', published_at: null }).eq('id', quiz.id);
      if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
      return NextResponse.json({ ok: true, quiz_id: quiz.id, status: 'draft' });
    }

    if (body.action === 'archive') {
      const { error } = await admin.from('quizzes').update({ status: 'archived' }).eq('id', quiz.id);
      if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
      return NextResponse.json({ ok: true, quiz_id: quiz.id, status: 'archived' });
    }

    // edit — title + per-question text/choices/rubric. Never touches status/published_at.
    const hasTitle = typeof body.title === 'string';
    const questions = Array.isArray(body.questions) ? body.questions : [];
    if (!hasTitle && questions.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    if (hasTitle) {
      const title = body.title as string;
      if (title.length > MAX_TITLE) return NextResponse.json({ error: 'invalid_title' }, { status: 400 });
      const { error } = await admin.from('quizzes').update({ title }).eq('id', quiz.id);
      if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }

    for (const q of questions) {
      if (!q || typeof q !== 'object' || !q.id) return NextResponse.json({ error: 'invalid_question' }, { status: 400 });
      const qpatch: Record<string, unknown> = {};
      if ('question_text' in q) {
        if (typeof q.question_text !== 'string' || q.question_text.length > MAX_QUESTION_TEXT)
          return NextResponse.json({ error: 'invalid_question' }, { status: 400 });
        qpatch.question_text = q.question_text;
      }
      if ('choices' in q) qpatch.choices = q.choices ?? null;
      if ('rubric' in q) {
        if (q.rubric != null && (typeof q.rubric !== 'string' || q.rubric.length > MAX_RUBRIC))
          return NextResponse.json({ error: 'invalid_question' }, { status: 400 });
        qpatch.rubric = q.rubric ?? null;
      }
      if (Object.keys(qpatch).length === 0) continue;
      // Scope the write to this quiz's questions so a forged question id from another quiz
      // can never be edited (the guard covers the class; this covers the row).
      const { error } = await admin.from('quiz_questions').update(qpatch).eq('quiz_id', quiz.id).eq('id', q.id);
      if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, quiz_id: quiz.id });
  } catch (err) {
    console.error('[quizzes/manage] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
