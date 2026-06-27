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

// ── T3 stub (implemented in next commit) ─────────────────────────────────────

/** Stub — implemented in Seg5 T3 */
export async function gradeChapterAttempt(
  attemptId: string,
  admin: SupabaseClient,
): Promise<void> {
  void attemptId;
  void admin;
}
