// src/lib/signals/loadStudentQuizDetails.ts
// Teacher-only loader. Reads quiz attempts + responses for a single student.
// Uses the admin client (bypasses RLS — quiz_attempts RLS restricts to student_id = auth.uid()).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface QuizResponseDetail {
  questionText: string;
  questionType: string;
  choices: string[] | null;
  correctAnswer: string | null;
  studentAnswer: string | null;
  isCorrect: boolean | null;
  aiScore: number | null;
}

export interface QuizAttemptDetail {
  attemptId: string;
  quizTitle: string | null;
  scorePct: number | null;
  masteryBand: string | null;
  learningStyle: string | null;
  submittedAt: string | null;
  responses: QuizResponseDetail[];
}

type AttemptRow = {
  id: string;
  quiz_id: string;
  score_pct: number | null;
  mastery_band: string | null;
  learning_style: string | null;
  submitted_at: string | null;
  quizzes: { title: string | null } | null;
};

type ResponseRow = {
  attempt_id: string;
  question_id: string | null;
  response_text: string | null;
  is_correct: boolean | null;
  ai_score: number | null;
  quiz_questions: {
    question_text: string;
    question_type: string;
    choices: unknown;
    correct_answer: string | null;
  } | null;
};

export async function loadStudentQuizDetails(
  admin: SupabaseClient,
  studentId: string,
): Promise<QuizAttemptDetail[]> {
  const { data: attemptsData } = await admin
    .from('quiz_attempts')
    .select('id, quiz_id, score_pct, mastery_band, learning_style, submitted_at, quizzes:quiz_id(title)')
    .eq('student_id', studentId)
    .eq('is_complete', true)
    .order('submitted_at', { ascending: false })
    .limit(3);

  const attempts = (attemptsData ?? []) as unknown as AttemptRow[];
  if (attempts.length === 0) return [];

  const attemptIds = attempts.map((a) => a.id);
  const { data: responsesData } = await admin
    .from('quiz_responses')
    .select('attempt_id, question_id, response_text, is_correct, ai_score, quiz_questions:question_id(question_text, question_type, choices, correct_answer)')
    .in('attempt_id', attemptIds);

  const byAttempt = new Map<string, ResponseRow[]>();
  for (const r of (responsesData ?? []) as unknown as ResponseRow[]) {
    const list = byAttempt.get(r.attempt_id);
    if (list) {
      list.push(r);
    } else {
      byAttempt.set(r.attempt_id, [r]);
    }
  }

  return attempts.map((a): QuizAttemptDetail => ({
    attemptId: a.id,
    quizTitle: a.quizzes?.title ?? null,
    scorePct: a.score_pct,
    masteryBand: a.mastery_band,
    learningStyle: a.learning_style,
    submittedAt: a.submitted_at,
    responses: (byAttempt.get(a.id) ?? []).map((r): QuizResponseDetail => ({
      questionText: r.quiz_questions?.question_text ?? '',
      questionType: r.quiz_questions?.question_type ?? 'open',
      choices: Array.isArray(r.quiz_questions?.choices) ? (r.quiz_questions!.choices as string[]) : null,
      correctAnswer: r.quiz_questions?.correct_answer ?? null,
      studentAnswer: r.response_text,
      isCorrect: r.is_correct,
      aiScore: r.ai_score,
    })),
  }));
}
