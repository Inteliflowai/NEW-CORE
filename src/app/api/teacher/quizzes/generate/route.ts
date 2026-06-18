// src/app/api/teacher/quizzes/generate/route.ts
// POST — generate a quiz from a parsed lesson (engine call #2).
// Auth: supabase.auth.getUser() + role check (teacher-tier);
// guardClassAccess() for class-level IDOR protection (C3);
// atomic quiz creation (C21): on quiz_questions insert failure, delete the draft quiz row.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { generateQuiz } from '@/lib/engine/quizGen';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';

const TEACHER_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function POST(req: NextRequest) {
  try {
    // ── 1. Auth + role check ────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('users').select('role').eq('id', user.id).single();
    const role: string | null = profile?.role ?? null;
    if (!role || !TEACHER_ROLES.has(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── 2. Parse body ────────────────────────────────────────────────────────
    const { lesson_id } = await req.json();
    if (!lesson_id) return NextResponse.json({ error: 'Missing lesson_id' }, { status: 400 });

    // ── 3. Load lesson (admin client — bypasses RLS, guard is below) ─────────
    const admin = createAdminSupabaseClient();
    const { data: lesson } = await admin
      .from('lessons')
      .select('id, class_id, teacher_id, title, subject, parsed_content')
      .eq('id', lesson_id)
      .single();

    if (!lesson || !lesson.parsed_content) {
      return NextResponse.json({ error: 'Lesson not found or not parsed' }, { status: 404 });
    }

    // ── 4. Object-level guard: caller must own/teach this class ──────────────
    // RLS is NOT the backstop on admin reads — this guard is.
    const guard = await guardClassAccess(lesson.class_id as string);
    if (guard) return guard;

    // ── 5. Resolve subject (prefer lessons.subject, fall back to parsed_content.subject) ──
    const parsedSubject =
      typeof (lesson.parsed_content as Record<string, unknown>)?.subject === 'string'
        ? ((lesson.parsed_content as Record<string, unknown>).subject as string)
        : null;
    const subject = (lesson.subject as string | null) ?? parsedSubject;

    // ── 6. Engine call #2 — throws on LlmExhaustedError or malformed quiz ────
    // C1: no degrade path. A malformed quiz (fails GeneratedQuizSchema 3+2 structure)
    // is a terminal generation failure — route catch maps to respondEngineError → 503.
    const result = await generateQuiz(JSON.stringify(lesson.parsed_content, null, 2), subject);

    const isMath = result.questions.some(q => q.question_type === 'numeric');

    // ── 7. Atomic create (C21) ───────────────────────────────────────────────
    // 7a. Insert quiz header row
    const { data: quiz, error: quizErr } = await admin
      .from('quizzes')
      .insert({
        lesson_id,
        class_id: lesson.class_id,
        teacher_id: lesson.teacher_id,
        title: result.title || `Quiz: ${lesson.title}`,
        status: 'draft',
        generation_model: OPENAI_GEN_MODEL,
        rubric_version: 'v1',
        ...(isMath ? { is_math: true } : {}),
      })
      .select()
      .single();

    if (quizErr || !quiz) {
      return NextResponse.json({ error: 'Failed to save quiz' }, { status: 500 });
    }

    // 7b. Insert question rows — check for error; on failure, delete the draft quiz (C21)
    const rows = result.questions.map(q => ({
      quiz_id: (quiz as Record<string, unknown>).id,
      position: q.position,
      question_type: q.question_type,
      question_text: q.question_text,
      choices: q.choices ?? null,
      correct_answer: q.correct_answer ?? null,
      rubric: q.rubric ?? null,
      numeric_spec: q.numeric_spec ?? null,
      concept_tag: q.concept_tag ?? null,
    }));

    const { error: qErr } = await admin.from('quiz_questions').insert(rows);

    if (qErr) {
      // C21: partial write — roll back by deleting the orphaned quiz header.
      // Suppress rollback error (best-effort); the primary error is reported.
      await admin.from('quizzes').delete().eq('id', (quiz as Record<string, unknown>).id);
      return respondEngineError(new Error(`Failed to save quiz questions: ${qErr.message}`));
    }

    return NextResponse.json({
      quiz_id: (quiz as Record<string, unknown>).id,
      questions: result.questions,
    });
  } catch (err) {
    console.error('[teacher/quizzes/generate] error:', err);
    return respondEngineError(err);
  }
}
