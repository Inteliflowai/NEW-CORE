// src/lib/quizzes/loadQuizLibrary.ts
// Pure quiz-library loader — NO auth (caller guards via guardClassAccess). Mirrors loadGradebook
// style: a few batched queries, no N+1.
//
// 3 batched reads:
//   1. quizzes for the class, excluding archived (.neq('status','archived'))
//   2. quiz_questions for those quizzes → per-quiz question_count
//   3. lessons (id,title) for the referenced lesson_ids → resolve lesson_title
//
// Ordering: published-first (published_at desc, nulls last) then created_at desc — so a teacher
// sees what's live to students at the top, then the most recent drafts.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface QuizLibRow {
  id: string;
  title: string;
  lesson_title: string | null;
  /** Subject + grade are inherited from the linked lesson, for Subject·Grade categorization. */
  subject: string | null;
  grade_level: string | null;
  status: string;
  question_count: number;
  published_at: string | null;
  created_at: string;
}
export interface QuizLibrary {
  class_id: string;
  quizzes: QuizLibRow[];
}

const NONE = ['__none__'];

type QzRow = { id: string; title: string | null; lesson_id: string | null; status: string; published_at: string | null; created_at: string | null };
type QqRow = { id: string; quiz_id: string };
type LessonRow = { id: string; title: string | null; subject: string | null; grade_level: string | null };

export async function loadQuizLibrary(admin: SupabaseClient, args: { classId: string }): Promise<QuizLibrary> {
  const { classId } = args;

  // 1. Quizzes for the class, archived excluded.
  const { data: qzData } = await admin.from('quizzes')
    .select('id, title, lesson_id, status, published_at, created_at')
    .eq('class_id', classId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });
  const qzRows = (qzData ?? []) as QzRow[];
  const quizIds = qzRows.map((q) => q.id);

  // 2. Question counts (per quiz_id).
  const { data: qqData } = await admin.from('quiz_questions')
    .select('id, quiz_id')
    .in('quiz_id', quizIds.length ? quizIds : NONE);
  const countByQuiz = new Map<string, number>();
  for (const r of ((qqData ?? []) as QqRow[])) countByQuiz.set(r.quiz_id, (countByQuiz.get(r.quiz_id) ?? 0) + 1);

  // 3. Lesson titles (per lesson_id).
  const lessonIds = [...new Set(qzRows.map((q) => q.lesson_id).filter((x): x is string => x != null))];
  const { data: lessonData } = await admin.from('lessons')
    .select('id, title, subject, grade_level')
    .in('id', lessonIds.length ? lessonIds : NONE);
  const lessonById = new Map<string, LessonRow>(
    ((lessonData ?? []) as LessonRow[]).map((l) => [l.id, l] as const));

  const quizzes: QuizLibRow[] = qzRows.map((q) => {
    const lesson = q.lesson_id ? lessonById.get(q.lesson_id) ?? null : null;
    return {
    id: q.id,
    title: q.title ?? 'Untitled check',
    lesson_title: lesson?.title ?? null,
    subject: lesson?.subject ?? null,
    grade_level: lesson?.grade_level ?? null,
    status: q.status,
    question_count: countByQuiz.get(q.id) ?? 0,
    published_at: q.published_at ?? null,
    created_at: q.created_at ?? '',
    };
  });

  // Order: published-first (published_at desc, nulls last), then created_at desc.
  quizzes.sort((a, b) => {
    const ap = a.published_at; const bp = b.published_at;
    if (ap && bp) return bp.localeCompare(ap);
    if (ap && !bp) return -1;
    if (!ap && bp) return 1;
    return b.created_at.localeCompare(a.created_at);
  });

  return { class_id: classId, quizzes };
}
