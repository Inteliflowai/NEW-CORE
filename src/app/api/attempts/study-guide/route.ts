// ============================================================
// src/app/api/attempts/study-guide/route.ts
// POST /api/attempts/study-guide
//
// Generates (or returns a cached) AI revision study guide from a student's
// wrong answers on a completed quiz attempt.
//
// Auth chain (V2 pattern — mirrors start/route.ts):
//   createServerSupabaseClient() → auth.getUser() → 401 if no user
//   createAdminSupabaseClient() → bypasses RLS; ownership is the IDOR backstop
//
// Response shapes:
//   401  no authenticated user
//   400  missing quiz_attempt_id
//   404  attempt not found
//   403  attempt belongs to a different student
//   200  { study_guide, cached: true }  — cache hit (no LLM call)
//   200  { study_guide, cached: false } — freshly generated + written to cache
//   200  { study_guide: null, cached: false, unavailable: true }
//        — graceful degrade: no OpenAI key or LLM error (study guide is optional)
//
// Coach-posture note: prompt asks for plain, encouraging, growth-framed language.
// No scores, percentages, or jargon are surfaced to the student.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_VOICE_MODEL } from '@/lib/ai/models';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  const body = await req.json() as Record<string, unknown>;
  const quiz_attempt_id = body.quiz_attempt_id as string | undefined;
  if (!quiz_attempt_id) {
    return NextResponse.json({ error: 'Missing quiz_attempt_id' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // ── 3. Load attempt + ownership check ─────────────────────────────────────
  const { data: attempt } = await admin
    .from('quiz_attempts')
    .select('id, student_id, quiz_id, score_pct, study_guide')
    .eq('id', quiz_attempt_id)
    .single();

  if (!attempt) {
    return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
  }

  const row = attempt as {
    id: string;
    student_id: string;
    quiz_id: string;
    score_pct: number | null;
    study_guide: string | null;
  };

  // Ownership: 403 (not 404) so caller knows the resource exists but is forbidden.
  // Admin client bypasses RLS — this guard is the IDOR backstop.
  if (row.student_id !== user.id) {
    return NextResponse.json({ error: 'Not your attempt' }, { status: 403 });
  }

  // ── 4. Cache hit → return immediately (no LLM call) ───────────────────────
  if (row.study_guide) {
    return NextResponse.json({ study_guide: row.study_guide, cached: true });
  }

  // ── 5. Build wrong-answer summary ─────────────────────────────────────────
  const { data: responses } = await admin
    .from('quiz_responses')
    .select('position, response_text, is_correct, ai_score, ai_score_explanation, question_type_scored')
    .eq('attempt_id', quiz_attempt_id)
    .order('position');

  const { data: questions } = await admin
    .from('quiz_questions')
    .select('position, question_text, correct_answer, question_type')
    .eq('quiz_id', row.quiz_id)
    .order('position');

  type ResponseRow = {
    position: number;
    response_text: string | null;
    is_correct: boolean | null;
    ai_score: number | null;
    ai_score_explanation: string | null;
    question_type_scored: string | null;
  };

  type QuestionRow = {
    position: number;
    question_text: string;
    correct_answer: string | null;
    question_type: string;
  };

  const responseList = (responses ?? []) as ResponseRow[];
  const questionList = (questions ?? []) as QuestionRow[];

  // A response is "wrong" when:
  //   - MCQ/mcq: is_correct === false
  //   - Non-MCQ (open, numeric): is_correct === false OR ai_score < 0.7
  // Use question_type_scored from the response row (avoids an extra join).
  // Fall back to the question's question_type if question_type_scored is null.
  const wrongAnswers: string[] = [];
  for (const q of questionList) {
    const r = responseList.find((resp) => resp.position === q.position);
    if (!r) continue;

    const typeScored = r.question_type_scored ?? q.question_type;
    const isMcq = typeScored === 'mcq';
    const isWrong =
      r.is_correct === false ||
      (!isMcq && r.ai_score !== null && r.ai_score < 0.7);

    if (isWrong) {
      wrongAnswers.push(
        `Question ${q.position}: "${q.question_text}"\n` +
        `Student answered: "${r.response_text ?? '(no answer)'}"\n` +
        `Correct: "${q.correct_answer ?? '(see rubric)'}"\n` +
        (r.ai_score_explanation ? `Feedback: ${r.ai_score_explanation}` : ''),
      );
    }
  }

  // ── 6. All-correct shortcut — no LLM needed ───────────────────────────────
  if (wrongAnswers.length === 0) {
    const guide = 'Great work — you got everything right on this quiz! Keep it up.';
    await admin
      .from('quiz_attempts')
      .update({ study_guide: guide })
      .eq('id', quiz_attempt_id);
    return NextResponse.json({ study_guide: guide, cached: false });
  }

  // ── 7. Generate with LLM, cache result, gracefully degrade on error ────────
  const systemPrompt =
    'You are a warm, encouraging tutor helping a student review what they missed on a quiz. ' +
    'Write a short, friendly revision guide (max 250 words) that explains the concepts the student ' +
    'needs to revisit. Use simple, clear language and a positive, growth-focused tone. ' +
    'Do NOT mention scores, percentages, or grades. Focus on the concept, not the mistake. ' +
    'Format the guide as 2-3 short sections with **bold** headings. ' +
    'Never make the student feel bad — frame everything as an opportunity to grow.';

  const userMessage =
    `Here are the questions the student got wrong on their quiz:\n\n` +
    wrongAnswers.join('\n\n') +
    `\n\nPlease write a revision guide to help them understand these concepts.`;

  try {
    const completion = await resilientChatCompletion(
      {
        model: OPENAI_VOICE_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.5,
        max_tokens: 400,
      },
      { timeoutMs: 20000 },
    );

    const guide =
      completion?.choices?.[0]?.message?.content?.trim() ??
      'Unable to generate a study guide right now. Try again later.';

    // Cache into quiz_attempts.study_guide
    await admin
      .from('quiz_attempts')
      .update({ study_guide: guide })
      .eq('id', quiz_attempt_id);

    return NextResponse.json({ study_guide: guide, cached: false });
  } catch (err) {
    // Graceful degrade: study guide is optional — never 500 the client.
    // Covers LlmExhaustedError (no key, rate-limit exhausted, etc.) and any
    // other unexpected LLM error.
    console.error('[study-guide] LLM unavailable (non-blocking):', err);
    return NextResponse.json({ study_guide: null, cached: false, unavailable: true });
  }
}
