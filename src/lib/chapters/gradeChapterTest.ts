// src/lib/chapters/gradeChapterTest.ts
// Grading pipeline for chapter test attempts.
//
// T1 — Synchronous exact-match graders (gradeMcq, gradeMatching)
// T2 — Claude rubric-based open-ended grader (gradeOpenEnded) — Seg5 T2
// T3 — Orchestrator (gradeChapterAttempt) — Seg5 T3
//
// NEVER throws — all exported functions are fail-soft. gradeChapterAttempt is
// called from after() in the submit route and must never propagate exceptions.

import type { SupabaseClient } from '@supabase/supabase-js';

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

// ── T2 + T3 stubs (implemented in subsequent commits) ─────────────────────────

/** Stub — implemented in Seg5 T2 */
export async function gradeOpenEnded(
  _question: QuestionRow,
  _response: ResponseRow | null,
): Promise<GradeResult> {
  return { grade: 0, ai_feedback: '' };
}

/** Stub — implemented in Seg5 T3 */
export async function gradeChapterAttempt(
  attemptId: string,
  admin: SupabaseClient,
): Promise<void> {
  void attemptId;
  void admin;
}
