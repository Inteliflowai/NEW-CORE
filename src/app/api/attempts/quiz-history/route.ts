// ============================================================
// src/app/api/attempts/quiz-history/route.ts
// GET  /api/attempts/quiz-history           — student's completed-quiz list
// POST /api/attempts/quiz-history           — per-question review for one attempt
//
// Option-D discipline:
//   NEVER spread a quiz_attempts row into the response payload.
//   score_pct and mastery_band are fetched internally (ownership checks need
//   the row) but are deliberately NOT included in any response shape.
//   Every response object is constructed FIELD-BY-FIELD.
//
// Auth chain (V2 standard):
//   await createServerSupabaseClient() → auth.getUser() → 401 if no user
//   createAdminSupabaseClient() — bypasses RLS; ownership is the IDOR backstop
//   (all queries scoped to user.id via student_id / enrollments).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

// ── GET: completed quiz history (optional ?class_id= filter) ─────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminSupabaseClient();
    const classId = req.nextUrl.searchParams.get('class_id');

    // ── 2. Student's active enrollments ──────────────────────────────────────
    const { data: enrollments } = await admin
      .from('enrollments')
      .select('class_id')
      .eq('student_id', user.id)
      .eq('is_active', true);

    if (!enrollments?.length) {
      return NextResponse.json({ classes: [], quizzes: [] });
    }

    const enrolledClassIds = [...new Set((enrollments as { class_id: string }[]).map(e => e.class_id))];

    // ── 3. Class details for the filter picker ────────────────────────────────
    const { data: classRows } = await admin
      .from('classes')
      .select('id, name')
      .in('id', enrolledClassIds);

    // Build classes array field-by-field (no row spread)
    const classes = (classRows as { id: string; name: string }[] | null ?? []).map(c => ({
      id: c.id,
      name: c.name,
    }));

    // ── 4. Completed quiz attempts (scoped to this student) ───────────────────
    const { data: attempts } = await admin
      .from('quiz_attempts')
      .select('id, quiz_id, submitted_at, is_complete, score_pct, mastery_band')
      .eq('student_id', user.id)
      .eq('is_complete', true)
      .order('submitted_at', { ascending: false });

    if (!attempts?.length) {
      return NextResponse.json({ classes, quizzes: [] });
    }

    type AttemptRow = {
      id: string;
      quiz_id: string;
      submitted_at: string | null;
      is_complete: boolean;
      score_pct: number | null;
      mastery_band: string | null;
    };

    const attemptRows = attempts as AttemptRow[];
    const quizIds = [...new Set(attemptRows.map(a => a.quiz_id))];

    // Determine which class IDs to scope the quiz lookup to
    const queryClassIds = classId ? [classId] : enrolledClassIds;

    // ── 5. Quiz metadata (filtered by class scope) ────────────────────────────
    const { data: quizRows } = await admin
      .from('quizzes')
      .select('id, title, class_id')
      .in('id', quizIds)
      .in('class_id', queryClassIds);

    if (!quizRows?.length) {
      return NextResponse.json({ classes, quizzes: [] });
    }

    type QuizRow = { id: string; title: string; class_id: string };
    const quizMap = new Map((quizRows as QuizRow[]).map(q => [q.id, q]));
    const classMap = new Map((classRows as { id: string; name: string }[] | null ?? []).map(c => [c.id, c]));

    // ── 6. Build response array FIELD-BY-FIELD (Option-D: no row spread) ─────
    // score_pct and mastery_band are present on attemptRows but are deliberately
    // NOT copied into the output object — the comment below documents intent.
    const quizzes = attemptRows
      .filter(a => quizMap.has(a.quiz_id))
      .map(a => {
        const quiz = quizMap.get(a.quiz_id)!;
        const cls = classMap.get(quiz.class_id);
        // Option-D: score_pct (a.score_pct) and mastery_band (a.mastery_band) are
        // available here but are deliberately excluded from the student payload.
        return {
          attempt_id: a.id,
          quiz_id:    a.quiz_id,
          quiz_title: quiz.title,
          class_id:   quiz.class_id,
          class_name: cls?.name ?? '',
          submitted_at: a.submitted_at,
        };
      });

    return NextResponse.json({ classes, quizzes });
  } catch (err) {
    console.error('[quiz-history GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST: per-question review for a specific attempt ─────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminSupabaseClient();

    // ── 2. Parse body ─────────────────────────────────────────────────────────
    const body = await req.json() as Record<string, unknown>;
    const attempt_id = body.attempt_id as string | undefined;
    if (!attempt_id) {
      return NextResponse.json({ error: 'Missing attempt_id' }, { status: 400 });
    }

    // ── 3. Ownership gate (IDOR backstop) ─────────────────────────────────────
    // We fetch score_pct/mastery_band here to confirm the row exists, but we
    // do NOT pass them through to the response.
    const { data: attempt } = await admin
      .from('quiz_attempts')
      .select('id, quiz_id, student_id, score_pct, mastery_band')
      .eq('id', attempt_id)
      .eq('student_id', user.id)
      .single();

    if (!attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    type AttemptOwnerRow = {
      id: string;
      quiz_id: string;
      student_id: string;
      score_pct: number | null;
      mastery_band: string | null;
    };
    const ownedAttempt = attempt as AttemptOwnerRow;

    // ── 4. Quiz questions (ordered by position) ───────────────────────────────
    const { data: questions } = await admin
      .from('quiz_questions')
      .select('id, position, question_type, question_text, correct_answer, choices, rubric')
      .eq('quiz_id', ownedAttempt.quiz_id)
      .order('position');

    // ── 5. Student responses for this attempt ────────────────────────────────
    const { data: responses } = await admin
      .from('quiz_responses')
      .select('question_id, position, response_text, is_correct, ai_score, ai_score_explanation')
      .eq('attempt_id', attempt_id)
      .order('position');

    type QuestionRow = {
      id: string;
      position: number;
      question_type: string;
      question_text: string;
      correct_answer: string | null;
      choices: unknown[] | null;
      rubric: string | null;
    };

    type ResponseRow = {
      question_id: string;
      position: number;
      response_text: string | null;
      is_correct: boolean | null;
      ai_score: number | null;
      ai_score_explanation: string | null;
    };

    // Merge by position — keyed on position because V1 uses position linkage
    const responseMap = new Map(
      (responses as ResponseRow[] | null ?? []).map(r => [r.position, r]),
    );

    // ── 6. Build review array FIELD-BY-FIELD (Option-D: no row spread) ───────
    // score_pct / mastery_band from ownedAttempt are deliberately NOT included.
    // ai_score is a raw per-question number (included for Barb / Phase-3 UI to
    // present qualitatively; it is not an "overall score").
    const review = (questions as QuestionRow[] | null ?? []).map(q => {
      const resp = responseMap.get(q.position);
      return {
        position:      q.position,
        question_type: q.question_type,
        question_text: q.question_text,
        correct_answer: q.correct_answer,
        choices:       q.choices,
        rubric:        q.rubric,
        student_answer: resp?.response_text ?? '',
        is_correct:    resp?.is_correct ?? null,
        ai_score:      resp?.ai_score ?? null,
        explanation:   resp?.ai_score_explanation ?? '',
      };
    });

    // Option-D: { review } only — no overall score key in this response.
    return NextResponse.json({ review });
  } catch (err) {
    console.error('[quiz-history POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
