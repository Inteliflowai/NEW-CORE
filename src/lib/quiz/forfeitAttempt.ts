// ============================================================
// src/lib/quiz/forfeitAttempt.ts
//
// Minimal forfeit pipeline. Closes a stranded quiz attempt and
// scores whatever the student answered — synchronous, MCQ + numeric
// only, no LLM cost. Open-response questions remain ungraded;
// unanswered questions count as 0.
//
// Score model:
//   score_pct = round(correct_deterministic / total_questions * 100)
//   open-response and unanswered → contribute 0 to numerator
//
// Band: via computeMasteryBand ONLY (single source; never inline cuts).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeMasteryBand, scoreMCQ } from '@/lib/utils/scoring';
import { checkNumericAnswer, type NumericCheckSpec } from '@/lib/math/checkNumericAnswer';

export type ForfeitReason = 'closure' | 'time_up';

export interface ForfeitArgs {
  admin: SupabaseClient;
  attemptId: string;
  reason: ForfeitReason;
}

export type ForfeitResult =
  | { ok: true; scorePct: number; masteryBand: string }
  | { ok: false; error: string };

export async function forfeitAttempt(args: ForfeitArgs): Promise<ForfeitResult> {
  const { admin, attemptId, reason } = args;

  // ── 1. Read the attempt ───────────────────────────────────────────────────
  const { data: attempt, error: attemptErr } = await admin
    .from('quiz_attempts')
    .select('id, quiz_id, last_active_at, is_complete')
    .eq('id', attemptId)
    .single();

  if (attemptErr || !attempt) {
    return { ok: false, error: `attempt not found: ${attemptErr?.message ?? 'unknown'}` };
  }

  if ((attempt as { is_complete: boolean }).is_complete) {
    return { ok: false, error: 'attempt already complete — refusing to overwrite' };
  }

  const submittedAt: string =
    (attempt as { last_active_at: string | null }).last_active_at ?? new Date().toISOString();

  // ── 2. Load quiz questions ────────────────────────────────────────────────
  const { data: questionRows, error: questionErr } = await admin
    .from('quiz_questions')
    .select('id, position, question_type, correct_answer, numeric_spec')
    .eq('quiz_id', (attempt as { quiz_id: string }).quiz_id)
    .order('position');

  if (questionErr || !questionRows || (questionRows as unknown[]).length === 0) {
    return { ok: false, error: `quiz_questions not found: ${questionErr?.message ?? 'no rows'}` };
  }

  // ── 3. Load saved responses ───────────────────────────────────────────────
  const { data: responseRows, error: responseErr } = await admin
    .from('quiz_responses')
    .select('question_id, position, response_text')
    .eq('attempt_id', attemptId);

  if (responseErr) {
    return { ok: false, error: `quiz_responses read failed: ${responseErr.message}` };
  }

  type QuestionRow = {
    id: string;
    position: number;
    question_type: string;
    correct_answer: string | null;
    numeric_spec: NumericCheckSpec | null;
  };

  type ResponseRow = {
    question_id: string;
    position: number;
    response_text: string | null;
  };

  const responsesByQuestionId = new Map<string, string>();
  for (const r of (responseRows ?? []) as ResponseRow[]) {
    if (typeof r.response_text === 'string') {
      responsesByQuestionId.set(r.question_id, r.response_text);
    }
  }

  // ── 4. Score deterministic question types (MCQ + numeric) ────────────────
  let correctCount = 0;

  for (const q of (questionRows as QuestionRow[])) {
    const qType = q.question_type;
    if (qType !== 'mcq' && qType !== 'numeric') continue;

    const text = responsesByQuestionId.get(q.id);
    if (!text || !String(text).trim()) continue;

    let isCorrect = false;

    if (qType === 'mcq') {
      isCorrect = scoreMCQ(text, q.correct_answer ?? '') === 1;
    } else {
      // numeric — prefer structured spec; fall back to correct_answer as single accepted value
      const rawSpec = q.numeric_spec;
      const spec: NumericCheckSpec =
        rawSpec && Array.isArray(rawSpec.accepted) && rawSpec.accepted.length > 0
          ? rawSpec
          : { accepted: q.correct_answer ? [String(q.correct_answer)] : [] };
      if (spec.accepted.length === 0) continue;
      isCorrect = checkNumericAnswer(String(text), spec).correct;
    }

    if (isCorrect) correctCount += 1;

    // Backfill is_correct / grader_source on the response row — best-effort
    const graderSource = qType === 'numeric' ? 'forfeit_numeric' : 'forfeit_mcq';
    try {
      await admin
        .from('quiz_responses')
        .update({
          is_correct: isCorrect,
          ai_score: isCorrect ? 1 : 0,
          grader_source: graderSource,
        })
        .eq('attempt_id', attemptId)
        .eq('question_id', q.id);
    } catch {
      // best-effort; do not fail the forfeit for a backfill error
    }
  }

  // ── 5. Compute score + band ───────────────────────────────────────────────
  const totalQuestions = (questionRows as QuestionRow[]).length;
  const scorePct =
    totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  // computeMasteryBand is the SINGLE band source — never inline the cut
  const masteryBand = computeMasteryBand(scorePct);

  // ── 6. Write the closed attempt ───────────────────────────────────────────
  const { error: updateErr } = await admin
    .from('quiz_attempts')
    .update({
      is_complete: true,
      submitted_at: submittedAt,
      score_pct: scorePct,
      mastery_band: masteryBand,
      forfeit_reason: reason,
    })
    .eq('id', attemptId);

  if (updateErr) {
    return { ok: false, error: `attempt update failed: ${updateErr.message}` };
  }

  return { ok: true, scorePct, masteryBand };
}
