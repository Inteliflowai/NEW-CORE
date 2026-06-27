// src/lib/chapters/gradeChapterTest.ts
// Grading pipeline for chapter test attempts.
//
// T1 — Synchronous exact-match graders (gradeMcq, gradeMatching)
// T2 — Claude rubric-based open-ended grader (gradeOpenEnded)
// T3 — Orchestrator (gradeChapterAttempt) — Seg5 T3
//
// NEVER throws — all exported functions are fail-soft. gradeChapterAttempt is
// called from after() in the submit route and must never propagate exceptions.

import type { SupabaseClient } from '@supabase/supabase-js';
import { resilientClaudeChat } from '@/lib/ai/claude';
import { CLAUDE_CHAPTER_MODEL } from '@/lib/ai/models';

// ── Public types ──────────────────────────────────────────────────────────────

export interface GradeResult {
  grade: number;
  ai_feedback: string;
}

// ── Internal row types (local — not from generated DB types) ──────────────────

interface QuestionRow {
  id: string;
  question_type: string;
  question_text: string;
  payload: Record<string, unknown>;
  points: number;
}

interface ResponseRow {
  response_text: string | null;
  response_payload: Record<string, unknown> | null;
}

// ── T1: Synchronous exact-match graders ──────────────────────────────────────

/**
 * Grade a multiple-choice question.
 *
 * Compares `response_payload.selected_label` against `payload.correct_answer`.
 * Returns full question.points on correct, 0 otherwise.
 * Grade is always within [0, question.points].
 */
export function gradeMcq(question: QuestionRow, response: ResponseRow | null): GradeResult {
  const correctAnswer = question.payload.correct_answer as string | undefined;
  const selectedLabel = response?.response_payload?.selected_label as string | undefined;

  if (correctAnswer != null && selectedLabel != null && selectedLabel === correctAnswer) {
    return { grade: question.points, ai_feedback: 'Correct.' };
  }

  const feedbackAnswer = correctAnswer ?? 'unknown';
  return {
    grade: 0,
    ai_feedback: `The correct answer was ${feedbackAnswer}.`,
  };
}

/**
 * Grade a matching question with partial credit.
 *
 * `payload.pairs` holds the correct `{left_idx, right_idx}` pairs (ordered).
 * `response_payload.pairs` holds the student's submitted pairs.
 *
 * Each correct pair at position i earns:
 *   - Math.floor(points / n) for i < n-1
 *   - points - Math.floor(points/n) * (n-1) for i === n-1  (absorbs remainder)
 *
 * Grade is clamped to [0, question.points].
 */
export function gradeMatching(question: QuestionRow, response: ResponseRow | null): GradeResult {
  const correctPairs = question.payload.pairs as
    | Array<{ left_idx: number; right_idx: number }>
    | undefined;

  if (!correctPairs || correctPairs.length === 0) {
    return { grade: 0, ai_feedback: 'No response.' };
  }

  const rawStudentPairs = response?.response_payload?.pairs;
  if (!rawStudentPairs || !Array.isArray(rawStudentPairs) || rawStudentPairs.length === 0) {
    return { grade: 0, ai_feedback: 'No response.' };
  }

  const studentPairs = rawStudentPairs as Array<{ left_idx: number; right_idx: number }>;

  const totalPairs = correctPairs.length;
  const base = Math.floor(question.points / totalPairs);
  const lastPairValue = question.points - base * (totalPairs - 1);

  let grade = 0;
  let correctCount = 0;

  for (let i = 0; i < correctPairs.length; i++) {
    const cp = correctPairs[i];
    const isLast = i === correctPairs.length - 1;
    const pairValue = isLast ? lastPairValue : base;

    const matched = studentPairs.some(
      (sp) => sp.left_idx === cp.left_idx && sp.right_idx === cp.right_idx,
    );

    if (matched) {
      grade += pairValue;
      correctCount++;
    }
  }

  grade = Math.max(0, Math.min(question.points, grade));

  return {
    grade,
    ai_feedback: `You matched ${correctCount} out of ${totalPairs} correctly.`,
  };
}

// ── T2: Claude open-ended grader ──────────────────────────────────────────────

/**
 * Grade an open-ended question using Claude as a rubric-based grader.
 *
 * Supported question_type values: short_answer, compare_contrast,
 * data_interpretation, mini_essay, multi_step_problem.
 *
 * Fail-soft:
 *  - null/empty response → { grade: 0, ai_feedback: 'No response.' } (no Claude call)
 *  - Claude returns null or throws → { grade: 0, ai_feedback: '' } + console.error
 *  - JSON parse error → { grade: 0, ai_feedback: '' } + console.error
 * Never throws.
 *
 * IMPORTANT: temperature is intentionally omitted — CLAUDE_CHAPTER_MODEL is
 * claude-opus-4-8 which returns HTTP 400 on temperature (CLAUDE.md GOTCHA).
 */
export async function gradeOpenEnded(
  question: QuestionRow,
  response: ResponseRow | null,
): Promise<GradeResult> {
  const responseText = response?.response_text?.trim();

  if (!responseText) {
    return { grade: 0, ai_feedback: 'No response.' };
  }

  const rubric = (question.payload.rubric as string | undefined) ?? 'Use your judgment.';

  const system =
    'You are a fair, calibrated grader for a middle/high school test. ' +
    'Return JSON only: { "grade": number, "feedback": string }. ' +
    'No markdown, no code fences, no extra text.';

  const user =
    `Question type: ${question.question_type}\n` +
    `Question: ${question.question_text}\n` +
    `Rubric: ${rubric}\n` +
    `Max points: ${question.points}\n\n` +
    `Student response:\n${responseText}\n\n` +
    `Return JSON with grade (0 to ${question.points}) and brief feedback for the student.`;

  try {
    const result = await resilientClaudeChat({
      system,
      messages: [{ role: 'user', content: user }],
      model: CLAUDE_CHAPTER_MODEL,
      max_tokens: 500,
      // temperature intentionally omitted — claude-opus-4-8 returns 400 on temperature
    });

    if (!result?.content) {
      console.error(
        '[gradeOpenEnded] Claude returned null/empty content for question',
        question.id,
      );
      return { grade: 0, ai_feedback: '' };
    }

    let parsed: { grade?: unknown; feedback?: unknown };
    try {
      parsed = JSON.parse(result.content) as { grade?: unknown; feedback?: unknown };
    } catch (parseErr) {
      console.error(
        '[gradeOpenEnded] JSON parse error for question',
        question.id,
        ':',
        parseErr,
      );
      return { grade: 0, ai_feedback: '' };
    }

    const rawGrade = typeof parsed.grade === 'number' ? parsed.grade : 0;
    const grade = Math.max(0, Math.min(question.points, rawGrade));
    const ai_feedback = typeof parsed.feedback === 'string' ? parsed.feedback : '';

    return { grade, ai_feedback };
  } catch (err) {
    console.error('[gradeOpenEnded] Unexpected error for question', question.id, ':', err);
    return { grade: 0, ai_feedback: '' };
  }
}

// ── T3: Orchestrator ──────────────────────────────────────────────────────────

/**
 * Grade all questions in a submitted chapter test attempt.
 *
 * Algorithm:
 *  1. Load attempt — skip if already graded; warn if not 'submitted'
 *  2. Load sections → questions for this student (personalized per student)
 *  3. Load existing responses
 *  4. For each question (serially): grade + upsert — fail-soft (grade=0 on error)
 *  5. Sum total_grade + total_max → update attempt to 'graded'
 *
 * Forfeit attempts (forfeit_reason set, status='submitted') are graded the same
 * way as normal submissions — blank questions get grade=0.
 *
 * Never throws — outer try/catch ensures this (caller is after()).
 */
export async function gradeChapterAttempt(
  attemptId: string,
  admin: SupabaseClient,
): Promise<void> {
  try {
    // Step 1: Load attempt
    const { data: attemptRaw, error: attemptError } = await admin
      .from('chapter_test_attempts')
      .select('id, student_id, chapter_test_id, status')
      .eq('id', attemptId)
      .single();

    if (attemptError || !attemptRaw) {
      console.error(
        '[gradeChapterAttempt] Failed to load attempt:',
        attemptId,
        attemptError,
      );
      return;
    }

    const attempt = attemptRaw as {
      id: string;
      student_id: string;
      chapter_test_id: string;
      status: string;
    };

    // Idempotency: skip if already graded
    if (attempt.status === 'graded') {
      return;
    }

    // Only grade submitted attempts (includes forfeit — status stays 'submitted')
    if (attempt.status !== 'submitted') {
      console.warn(
        '[gradeChapterAttempt] Attempt not in submitted state; skipping:',
        attemptId,
        'status:',
        attempt.status,
      );
      return;
    }

    // Step 2: Load sections for this chapter test
    const { data: sectionsRaw, error: sectionsError } = await admin
      .from('chapter_test_sections')
      .select('id')
      .eq('chapter_test_id', attempt.chapter_test_id);

    if (sectionsError || !sectionsRaw || (sectionsRaw as { id: string }[]).length === 0) {
      console.error(
        '[gradeChapterAttempt] Failed to load sections for test:',
        attempt.chapter_test_id,
        sectionsError,
      );
      return;
    }

    const sectionIds = (sectionsRaw as { id: string }[]).map((s) => s.id);

    // Step 3: Load questions for this student (personalized — keyed by student_id)
    const { data: questionsRaw, error: questionsError } = await admin
      .from('chapter_test_questions')
      .select('id, question_type, question_text, payload, points')
      .in('section_id', sectionIds)
      .eq('student_id', attempt.student_id);

    if (questionsError) {
      console.error('[gradeChapterAttempt] Failed to load questions:', questionsError);
      return;
    }

    const questions = (questionsRaw ?? []) as QuestionRow[];

    // Step 4: Load existing responses for this attempt
    const { data: responsesRaw } = await admin
      .from('chapter_test_responses')
      .select('question_id, response_text, response_payload')
      .eq('attempt_id', attemptId);

    const responseMap = new Map<string, ResponseRow>();
    for (const r of (responsesRaw ?? []) as Array<{ question_id: string } & ResponseRow>) {
      responseMap.set(r.question_id, {
        response_text: r.response_text,
        response_payload: r.response_payload,
      });
    }

    // Step 5: Grade each question serially — no Promise.all (pilot scale)
    let totalGrade = 0;
    let totalMax = 0;

    for (const question of questions) {
      const response = responseMap.get(question.id) ?? null;
      let result: GradeResult = { grade: 0, ai_feedback: '' };

      try {
        if (question.question_type === 'mcq') {
          result = gradeMcq(question, response);
        } else if (question.question_type === 'matching') {
          result = gradeMatching(question, response);
        } else {
          // All other types: short_answer, compare_contrast, data_interpretation,
          // mini_essay, multi_step_problem
          result = await gradeOpenEnded(question, response);
        }
      } catch (err) {
        console.error(
          '[gradeChapterAttempt] Error grading question:',
          question.id,
          err,
        );
        result = { grade: 0, ai_feedback: '' };
      }

      // Upsert response row with grade (fail-soft — log errors but keep going)
      const { error: upsertError } = await admin
        .from('chapter_test_responses')
        .upsert(
          {
            attempt_id: attemptId,
            question_id: question.id,
            grade: result.grade,
            ai_feedback: result.ai_feedback,
            graded_at: new Date().toISOString(),
          },
          { onConflict: 'attempt_id,question_id' },
        );

      if (upsertError) {
        console.error(
          '[gradeChapterAttempt] Upsert error for question:',
          question.id,
          upsertError,
        );
      }

      totalGrade += result.grade;
      totalMax += question.points;
    }

    // Step 6: Update attempt to graded
    const { error: updateError } = await admin
      .from('chapter_test_attempts')
      .update({
        status: 'graded',
        total_grade: totalGrade,
        total_max: totalMax,
      })
      .eq('id', attemptId);

    if (updateError) {
      console.error(
        '[gradeChapterAttempt] Failed to update attempt to graded:',
        updateError,
      );
    }
  } catch (err) {
    // Outer catch — never re-throw (caller is after())
    console.error(
      '[gradeChapterAttempt] Unexpected fatal error for attempt:',
      attemptId,
      err,
    );
  }
}
