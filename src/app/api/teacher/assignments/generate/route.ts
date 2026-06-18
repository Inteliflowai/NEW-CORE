// src/app/api/teacher/assignments/generate/route.ts
// POST /api/teacher/assignments/generate
// Engine call #5 (+ #5a) — generate a differentiated assignment for a student.
//
// Auth: auth.getUser() → 401. guardStudentAccess(attempt.student_id) → guard response.
// C15: class_id + lesson_id are read from the quizzes join (NOT from quiz_attempts).
// C20: if mastery_band is null → 409 refusal; generateAssignment is NOT called.
// C17: if no valid learning_style → build behavioral signals, call inferLearningStyle (#5a).
// C6:  normalizeLearningStyle applied ONLY at the persist boundary.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardStudentAccess } from '@/lib/auth/guards';
import { generateAssignment, inferLearningStyle } from '@/lib/engine/assignmentGen';
import { normalizeLearningStyle } from '@/lib/utils/learningStyle';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { computeBehavioralSummary, formatSignalsForPrompt } from '@/lib/utils/scoring';

export async function POST(req: NextRequest) {
  try {
    // ── Auth ─────────────────────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Input ────────────────────────────────────────────────────────────────
    const body = await req.json();
    const { quiz_attempt_id, learning_style: requestedStyle } = body as {
      quiz_attempt_id?: string;
      learning_style?: string;
    };
    if (!quiz_attempt_id) {
      return NextResponse.json({ error: 'Missing quiz_attempt_id' }, { status: 400 });
    }

    // ── Fetch attempt with quizzes join (C15: class_id + lesson_id from quizzes) ──
    const admin = createAdminSupabaseClient();
    const { data: attempt } = await admin
      .from('quiz_attempts')
      .select(
        'id, student_id, mastery_band, learning_style, quizzes(class_id, lesson_id, lessons(parsed_content, title)), users:student_id(full_name)',
      )
      .eq('id', quiz_attempt_id)
      .single();

    if (!attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    // ── Object-level guard: IDOR — RLS is NOT the backstop on the admin client ──
    const guard = await guardStudentAccess(attempt.student_id as string);
    if (guard) return guard;

    // ── C20: refuse when mastery_band is null (do NOT silently default) ──────
    const band = attempt.mastery_band as 'reteach' | 'grade_level' | 'advanced' | null;
    if (!band) {
      return NextResponse.json(
        {
          error:
            'Attempt not graded yet — submit and grade the quiz before generating an assignment.',
        },
        { status: 409 },
      );
    }

    // ── Resolve lesson content from the quizzes join (C15) ───────────────────
    const quizzesJoin = attempt.quizzes as unknown as {
      class_id: string;
      lesson_id: string;
      lessons: { parsed_content: unknown; title: string };
    } | null;
    const classId = quizzesJoin?.class_id ?? null;
    const lessonId = quizzesJoin?.lesson_id ?? null;
    const lesson = quizzesJoin?.lessons ?? null;
    const studentName =
      (attempt.users as { full_name?: string } | null)?.full_name ?? 'Student';
    const lessonSummary = JSON.stringify(lesson?.parsed_content ?? {}, null, 2);

    // ── C17: resolve learning style — infer if absent ────────────────────────
    // The brief's `style = learning_style || 'emerging'` silently skips #5a.
    // Correct path: if no style is present, build behavioral signals and invoke
    // inferLearningStyle so the 6-value style is actually determined, not assumed.
    const attemptStyle = (attempt.learning_style as string | null) || requestedStyle || null;
    let style: string;
    if (attemptStyle) {
      style = attemptStyle;
    } else {
      // No style on attempt or request — fetch behavioral telemetry and infer
      const { data: responses } = await admin
        .from('quiz_responses')
        .select('response_time_ms, hesitation_ms, answer_changes, word_count, response_text')
        .eq('quiz_attempt_id', quiz_attempt_id);

      const safeResponses = (responses ?? []) as Array<{
        response_time_ms?: number;
        hesitation_ms?: number;
        answer_changes: number;
        word_count?: number;
        response_text?: string;
      }>;

      const behavioral = computeBehavioralSummary(safeResponses);
      const wordCounts = safeResponses.map((r) => r.word_count ?? 0);
      const signals = formatSignalsForPrompt(behavioral, wordCounts);

      // #5a — infer; degrades to 'emerging' on failure (C1 within inferLearningStyle)
      const inferred = await inferLearningStyle(signals);
      style = inferred.learning_style;
    }

    // ── Engine call #5: generate assignment ──────────────────────────────────
    const assignment = await generateAssignment({
      lessonSummary,
      band,
      style,         // 6-value prompt vocabulary (read_write/tactile pass through)
      studentName,
    });

    // ── Persist (C6: normalizeLearningStyle ONLY at the write boundary) ──────
    const { data: row, error: insErr } = await admin
      .from('assignments')
      .insert({
        quiz_attempt_id: attempt.id,
        student_id: attempt.student_id,
        class_id: classId,          // C15: from quizzes join
        lesson_id: lessonId,        // C15: from quizzes join
        mastery_band: band,
        learning_style: normalizeLearningStyle(style), // C6: normalize at boundary
        content: assignment,
        status: 'draft',
        generation_model: OPENAI_GEN_MODEL,
      })
      .select()
      .single();

    if (insErr || !row) {
      return NextResponse.json({ error: 'Failed to save assignment' }, { status: 500 });
    }

    return NextResponse.json({ assignment_id: row.id, content: assignment });
  } catch (err) {
    console.error('[teacher/assignments/generate] error:', err);
    return respondEngineError(err);
  }
}
