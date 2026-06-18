// src/app/api/attempts/[attemptId]/submit/route.ts
// POST — submit a quiz attempt and grade it.
//
// Auth: supabase.auth.getUser() (401 if none). Caller must OWN the attempt
//       (.eq('student_id', user.id) — RLS is NOT the backstop).
//
// Scoring:
//   Positions 1–3: deterministic MCQ (scoreMCQ) / numeric (checkNumericAnswer) — C20/C23.
//   Positions 4–5: OEQ via gradeOpenResponse (Claude→GPT, C1/C2) run concurrently.
//
// Never-half-grade (C22):
//   ANY gradeOpenResponse failure OR any per-response .update() error → mark
//   grading_status:'pending' + grading_failed:true + return grading_delayed payload.
//   Band is ONLY written on the all-clean path.
//
// Cognitive taxonomy fields (C3): error_type / reasoning_pattern /
//   misinterpretation_detected / vocabulary_difficulty are NOT top-level columns;
//   they go into grading_output jsonb.
//
// Outer catch: respondEngineError(err) — C9 (no bare 500).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { gradeOpenResponse } from '@/lib/engine/grading';
import { scoreMCQ, computeFinalScore, computeMasteryBand } from '@/lib/utils/scoring';
import { checkNumericAnswer } from '@/lib/math/checkNumericAnswer';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  try {
    const { attemptId } = await params;

    // ── Auth ──────────────────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Ownership (admin client, caller must own the attempt) ─────────────
    const admin = createAdminSupabaseClient();
    const { data: attempt } = await admin
      .from('quiz_attempts')
      .select('id, student_id, is_complete, adapted_questions, quizzes(quiz_questions(*))')
      .eq('id', attemptId)
      .eq('student_id', user.id)
      .single();

    if (!attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    // ── Load questions and responses ──────────────────────────────────────
    type QuizQuestion = {
      position: number;
      question_type: string;
      question_text: string;
      choices: unknown;
      correct_answer: string | null;
      rubric: string | null;
      numeric_spec: { accepted: string[]; tolerance?: number } | null;
    };

    const allQuestions = (
      (attempt.quizzes as unknown as { quiz_questions: QuizQuestion[] } | null)?.quiz_questions ?? []
    ).sort((a, b) => a.position - b.position);

    const { data: allResponses } = await admin
      .from('quiz_responses')
      .select('position, response_text, is_correct')
      .eq('attempt_id', attemptId);

    const responses = allResponses ?? [];

    // ── Score positions 1–3 deterministically (C20/C23) ──────────────────
    const frontQuestions = allQuestions.filter(q => q.position <= 3);
    const mcqScores: number[] = [];
    const mcqWriteErrors: Array<{ position: number; error: unknown }> = [];

    for (const q of frontQuestions) {
      const resp = responses.find(r => r.position === q.position);
      const responseText = resp?.response_text ?? '';
      let isCorrect = false;

      if (q.question_type === 'mcq') {
        const score = scoreMCQ(responseText, q.correct_answer ?? '');
        isCorrect = score === 1;
        mcqScores.push(score);
      } else if (q.question_type === 'numeric' && q.numeric_spec) {
        const result = checkNumericAnswer(responseText, q.numeric_spec);
        isCorrect = result.correct;
        mcqScores.push(result.correct ? 1 : 0);
      } else {
        // Unknown front-question type — fail loud (defense-in-depth; C24 enforces mcq/numeric)
        console.error('[submit] Unknown question_type at position', q.position, ':', q.question_type);
        await admin.from('quiz_attempts').update({
          submitted_at: new Date().toISOString(),
          is_complete: true,
          grading_failed: true,
          grading_status: 'pending',
        }).eq('id', attemptId);
        return NextResponse.json({
          attempt_id: attemptId,
          grading_delayed: true,
          message: 'Your answers have been saved. Grading is temporarily delayed — check back shortly.',
        });
      }

      // Persist is_correct for positions 1–3
      const { error: writeErr } = await admin
        .from('quiz_responses')
        .update({ is_correct: isCorrect })
        .eq('attempt_id', attemptId)
        .eq('position', q.position);

      if (writeErr) {
        mcqWriteErrors.push({ position: q.position, error: writeErr });
      }
    }

    // C22: any MCQ/numeric write error → pending path
    if (mcqWriteErrors.length > 0) {
      console.error('[submit] MCQ/numeric write error(s):', mcqWriteErrors);
      await admin.from('quiz_attempts').update({
        submitted_at: new Date().toISOString(),
        is_complete: true,
        grading_failed: true,
        grading_status: 'pending',
      }).eq('id', attemptId);
      return NextResponse.json({
        attempt_id: attemptId,
        grading_delayed: true,
        message: 'Your answers have been saved. Grading is temporarily delayed — check back shortly.',
      });
    }

    // ── Grade positions 4–5 (OEQ) concurrently (C20) ─────────────────────
    const oeqQuestions = allQuestions.filter(q => q.position >= 4);

    type OeqTask = {
      position: number;
      questionText: string;
      rubric: string;
      responseText: string;
    };

    const oeqTasks: OeqTask[] = oeqQuestions.map(q => {
      // Use adapted question text when present (C20)
      const adaptedQs = (
        attempt.adapted_questions as { questions?: { position: number; question_text: string }[] } | null
      )?.questions;
      const adaptedText = adaptedQs?.find(aq => aq.position === q.position)?.question_text;
      const resp = responses.find(r => r.position === q.position);
      return {
        position: q.position,
        questionText: adaptedText ?? q.question_text,
        rubric: q.rubric ?? '',
        responseText: resp?.response_text ?? '',
      };
    });

    // Run concurrently; capture failures without short-circuiting Promise.all
    type OeqResult =
      | { task: OeqTask; grade: Awaited<ReturnType<typeof gradeOpenResponse>>; error: null }
      | { task: OeqTask; grade: null; error: unknown };

    const oeqResults: OeqResult[] = await Promise.all(
      oeqTasks.map(async (task): Promise<OeqResult> => {
        try {
          const grade = await gradeOpenResponse({
            questionText: task.questionText,
            rubric: task.rubric,
            response: task.responseText,
          });
          return { task, grade, error: null };
        } catch (err) {
          return { task, grade: null, error: err };
        }
      }),
    );

    // C22 + C1: any OEQ grade failure → pending path (never half-grade)
    const gradeFailures = oeqResults.filter(r => r.grade === null);
    if (gradeFailures.length > 0) {
      console.error('[submit] OEQ grade failure(s):', gradeFailures.map(f => ({ position: f.task.position, error: f.error })));
      await admin.from('quiz_attempts').update({
        submitted_at: new Date().toISOString(),
        is_complete: true,
        grading_failed: true,
        grading_status: 'pending',
      }).eq('id', attemptId);
      return NextResponse.json({
        attempt_id: attemptId,
        grading_delayed: true,
        message: 'Your answers have been saved. Grading is temporarily delayed — check back shortly.',
      });
    }

    // ── Persist OEQ grades (C3: cognitive taxonomy → grading_output jsonb) ──
    const responseWriteErrors: Array<{ position: number; error: unknown }> = [];

    for (const result of oeqResults) {
      const { grade, task } = result as { task: OeqTask; grade: NonNullable<OeqResult['grade']>; error: null };

      // Cognitive taxonomy fields NOT top-level columns → grading_output jsonb (C3)
      const gradingOutput = {
        error_type: grade.error_type,
        reasoning_pattern: grade.reasoning_pattern,
        misinterpretation_detected: grade.misinterpretation_detected,
        vocabulary_difficulty: grade.vocabulary_difficulty,
        cognitive_notes: grade.cognitive_notes,
      };

      const { error: writeErr } = await admin
        .from('quiz_responses')
        .update({
          ai_score: grade.score,
          ai_score_explanation: grade.explanation,
          confidence: grade.confidence,
          grader_source: grade.grader_source,
          question_type_scored: 'open',
          rubric_version: 'v1',
          grading_output: gradingOutput,
        })
        .eq('attempt_id', attemptId)
        .eq('position', task.position);

      if (writeErr) {
        responseWriteErrors.push({ position: task.position, error: writeErr });
      }
    }

    // C22: any per-response write error → pending path, band withheld
    if (responseWriteErrors.length > 0) {
      console.error('[submit] Per-response write error(s):', responseWriteErrors);
      await admin.from('quiz_attempts').update({
        submitted_at: new Date().toISOString(),
        is_complete: true,
        grading_failed: true,
        grading_status: 'pending',
      }).eq('id', attemptId);
      return NextResponse.json({
        attempt_id: attemptId,
        grading_delayed: true,
        message: 'Your answers have been saved. Grading is temporarily delayed — check back shortly.',
      });
    }

    // ── All-clean path: compute and persist band (C20/C23) ────────────────
    const openScores = (oeqResults as Array<{ grade: NonNullable<OeqResult['grade']> }>)
      .map(r => r.grade.score);
    const { rawScore, scorePct } = computeFinalScore(mcqScores, openScores);
    const masteryBand = computeMasteryBand(scorePct);

    const { error: finalUpdateError } = await admin
      .from('quiz_attempts')
      .update({
        submitted_at: new Date().toISOString(),
        is_complete: true,
        grading_status: 'complete',
        grading_failed: false,
        raw_score: rawScore,
        score_pct: scorePct,
        mastery_band: masteryBand,
      })
      .eq('id', attemptId);

    // C22: even the final update error → best-effort pending write, then grading_delayed
    if (finalUpdateError) {
      console.error('[submit] Final attempt update error:', finalUpdateError);
      // Best-effort: mark attempt re-queueable so Task 8 / re-grade can pick it up.
      // Band is withheld (the write was unreliable).
      await admin.from('quiz_attempts').update({
        submitted_at: new Date().toISOString(),
        is_complete: true,
        grading_failed: true,
        grading_status: 'pending',
      }).eq('id', attemptId);
      return NextResponse.json({
        attempt_id: attemptId,
        grading_delayed: true,
        message: 'Your answers have been saved. Grading is temporarily delayed — check back shortly.',
      });
    }

    // ── Skill state recompute (fail-isolated; Plan 3 Task 6) ─────────────────
    // Fired on the all-clean path only (grading_status:'complete' written above).
    // A recompute error logs but NEVER fails the submit response — the student's
    // grade is already committed at this point.
    // Does NOT fire on pending/failed paths (those return early above).
    try {
      void recomputeSkillStatesForStudent(admin, {
        studentId: attempt.student_id,
        schoolId: null, // recomputeSkillStatesForStudent resolves school_id from users.school_id internally when null
      }).catch((recomputeErr) => {
        console.warn('[submit] skill state recompute failed (non-blocking):', recomputeErr);
      });
    } catch (recomputeErr) {
      console.error('[submit] skill state recompute hook threw (non-blocking):', recomputeErr);
    }

    return NextResponse.json({
      attempt_id: attemptId,
      raw_score: rawScore,
      score_pct: scorePct,
      mastery_band: masteryBand,
      grades: oeqResults.map(r => ({
        position: r.task.position,
        score: (r as { grade: NonNullable<OeqResult['grade']> }).grade.score,
      })),
    });
  } catch (err) {
    console.error('[submit] error:', err);
    return respondEngineError(err);
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
