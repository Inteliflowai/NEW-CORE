// src/app/api/attempts/[attemptId]/adapt/route.ts
// POST — called after Q3; returns personalized Q4–Q5 for the in-progress attempt.
// Engine call #3: adapt never blocks — on any LLM failure it returns the original
// questions (adaptQuestions handles the fallback; this route never 503s on adapt).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { adaptQuestions } from '@/lib/engine/adapt';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
  try {
    const { attemptId } = await params;

    // Auth: require authenticated user
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminSupabaseClient();

    // Load attempt + quiz + lesson + questions.
    // Ownership enforced via .eq('student_id', user.id) — a student can only adapt their OWN attempt.
    const { data: attempt } = await admin
      .from('quiz_attempts')
      .select('*, quizzes(*, lessons(*), quiz_questions(*))')
      .eq('id', attemptId)
      .eq('student_id', user.id)
      .single();

    if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    if (attempt.is_complete) return NextResponse.json({ error: 'Already submitted' }, { status: 400 });

    // Return cached adapted questions if already generated for this attempt
    if (attempt.adapted_questions) {
      return NextResponse.json({ adapted: attempt.adapted_questions });
    }

    const quiz = attempt.quizzes;
    const questions = (quiz.quiz_questions as Array<{ position: number; question_text: string }>)
      .sort((a, b) => a.position - b.position);

    // Load MCQ responses (positions 1–3) to compute correctCount
    const { data: responses } = await admin
      .from('quiz_responses')
      .select('position, is_correct')
      .eq('attempt_id', attemptId)
      .lte('position', 3);

    const correctCount = (responses || []).filter((r: { is_correct?: boolean }) => r.is_correct).length;

    // adaptQuestions NEVER throws — on any failure it returns the original Q4/Q5.
    const adapted = await adaptQuestions({
      correctCount,
      lessonContext: JSON.stringify(quiz.lessons?.parsed_content || {}, null, 2).slice(0, 2000),
      originalQ4: questions.find((q) => q.position === 4)?.question_text || '',
      originalQ5: questions.find((q) => q.position === 5)?.question_text || '',
    });

    // Persist to adapted_questions (migration 0010 column); also persists fallback on failure.
    // Capture error: Supabase does NOT throw on write failure — a discarded error would
    // return HTTP 200 while nothing was persisted (silent data loss). adapt never blocks,
    // so we log the failure and still return the adapted result to the caller.
    const { error: updateError } = await admin
      .from('quiz_attempts')
      .update({ adapted_questions: adapted })
      .eq('id', attemptId);

    if (updateError) {
      console.error('[adapt] persist failed:', updateError);
    }

    return NextResponse.json({ adapted });
  } catch (err) {
    console.error('[adapt] error:', err);
    return respondEngineError(err);
  }
}
