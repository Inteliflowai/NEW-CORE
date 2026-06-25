// src/app/api/teacher/quizzes/generate/route.ts
// POST — create a quiz header row IMMEDIATELY (non-blocking) then fill questions
// in the background via Next's after(). The teacher's browser receives { quiz_id }
// as soon as the row is inserted (~50 ms); the LLM call (15-120 s) runs after().
//
// "0 questions" = quiz still building — the Quiz Library shows "Building…" for these.
// On LlmExhaustedError or any other after() failure the quiz row stays with 0 questions
// (visible to the teacher as still-building; they can delete/retry via the library).
//
// Auth: supabase.auth.getUser() + role check (teacher-tier);
// guardClassAccess() for class-level IDOR protection (C3).
import { NextRequest, NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { generateQuiz } from '@/lib/engine/quizGen';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { resolveSkillIds } from '@/lib/skills/resolveSkills';
import { LlmExhaustedError } from '@/lib/ai/errors';

export const runtime = 'nodejs';

const TEACHER_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function POST(req: NextRequest) {
  try {
    // ── 1. Auth + role check ────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('users').select('role, school_id').eq('id', user.id).single();
    const role: string | null = profile?.role ?? null;
    if (!role || !TEACHER_ROLES.has(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const schoolId: string | null = (profile as Record<string, unknown> | null)?.school_id as string | null ?? null;

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

    // ── 6. Create quiz header row IMMEDIATELY (status='draft', 0 questions) ──
    // The teacher receives { quiz_id } right away. Questions are filled in after().
    // "0 questions" == still building — the Quiz Library renders a "Building…" affordance.
    const { data: quiz, error: quizErr } = await admin
      .from('quizzes')
      .insert({
        lesson_id,
        class_id: lesson.class_id,
        teacher_id: lesson.teacher_id,
        title: `Quiz: ${lesson.title as string}`,
        status: 'draft',
        generation_model: OPENAI_GEN_MODEL,
      })
      .select()
      .single();

    if (quizErr || !quiz) {
      return NextResponse.json({ error: 'Failed to save quiz' }, { status: 500 });
    }

    const quizId = (quiz as Record<string, unknown>).id as string;

    // ── 7. Background: LLM call + question insert ────────────────────────────
    // Snapshot all data needed inside after() before the response is sent.
    const parsedLessonJson = JSON.stringify(lesson.parsed_content, null, 2);
    const snapshotSchoolId = schoolId;
    const snapshotSubject = subject;
    const snapshotTitle = lesson.title as string;

    after(async () => {
      try {
        // Engine call #2 — may take 15–120 s
        const result = await generateQuiz(parsedLessonJson, snapshotSubject);

        // Resolve concept_tags → skill_ids (fail-soft)
        let skillIdByTag = new Map<string, string>();
        try {
          const conceptTags = result.questions
            .map((q: { concept_tag?: string | null }) => q.concept_tag)
            .filter((t): t is string => typeof t === 'string' && t.length > 0);
          // Skip when the teacher has no school_id — never create skills under school_id='' (orphan rows).
          if (conceptTags.length > 0 && snapshotSchoolId) {
            skillIdByTag = await resolveSkillIds(admin, {
              schoolId: snapshotSchoolId,
              subject: snapshotSubject,
              tags: conceptTags,
              createdBy: 'ai',
            });
          }
        } catch (skillErr) {
          console.error('[quizzes/generate] skill resolution failed — proceeding without skill_id', skillErr);
        }

        const isMath = result.questions.some((q: { question_type: string }) => q.question_type === 'numeric');

        // Update quiz title (now known from LLM) and is_math flag
        await admin
          .from('quizzes')
          .update({
            title: result.title || `Quiz: ${snapshotTitle}`,
            ...(isMath ? { is_math: true } : {}),
          })
          .eq('id', quizId);

        // Insert question rows
        const rows = result.questions.map((q: {
          position: number;
          question_type: string;
          question_text: string;
          choices?: unknown;
          correct_answer?: unknown;
          rubric?: string | null;
          numeric_spec?: unknown;
          concept_tag?: string | null;
        }) => ({
          quiz_id: quizId,
          position: q.position,
          question_type: q.question_type,
          question_text: q.question_text,
          choices: q.choices ?? null,
          correct_answer: q.correct_answer ?? null,
          rubric: q.rubric ?? null,
          rubric_version: 'v1',
          numeric_spec: q.numeric_spec ?? null,
          concept_tag: q.concept_tag ?? null,
          skill_id: (q.concept_tag && skillIdByTag.get(q.concept_tag)) || null,
        }));

        const { error: qErr } = await admin.from('quiz_questions').insert(rows);
        if (qErr) {
          // On question-insert failure the quiz row stays with 0 questions (still-building state).
          // The teacher can see and delete/retry it in the Quiz Library. Never throw out of after().
          console.error('[quizzes/generate] quiz_questions insert failed — quiz stays question-less:', qErr.message);
          return;
        }
      } catch (err) {
        if (err instanceof LlmExhaustedError) {
          console.error('[quizzes/generate] LLM exhausted — quiz stays question-less; teacher can retry:', (err as Error).message);
        } else {
          console.error('[quizzes/generate] unexpected error in after():', err);
        }
        // Never throw out of after() — the 200 has already been sent
      }
    });

    // ── 8. Return immediately — teacher is freed ─────────────────────────────
    return NextResponse.json({ quiz_id: quizId });
  } catch (err) {
    console.error('[teacher/quizzes/generate] error:', err);
    return respondEngineError(err);
  }
}
