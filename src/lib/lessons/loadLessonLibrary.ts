// src/lib/lessons/loadLessonLibrary.ts
// Pure Lesson-Library loader — NO auth (caller guards via guardClassAccess). Mirrors loadGradebook.
// 2 batched queries (no N+1): lessons for the class (archived excluded) + quizzes counted per lesson_id.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface LessonLibRow {
  id: string;
  title: string;
  subject: string | null;
  grade_level: string | null;
  status: string;
  quiz_count: number;
  created_at: string;
}
export interface LessonLibrary {
  class_id: string;
  lessons: LessonLibRow[];
}

type LessonRow = { id: string; title: string | null; subject: string | null; grade_level: string | null; status: string | null; created_at: string | null };
type QuizRow = { id: string; lesson_id: string | null };

export async function loadLessonLibrary(admin: SupabaseClient, args: { classId: string }): Promise<LessonLibrary> {
  const { classId } = args;

  // 1. Lessons for the class — soft-deleted (archived) excluded; newest-first.
  const { data: lessonData } = await admin.from('lessons')
    .select('id, title, subject, grade_level, status, created_at')
    .eq('class_id', classId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });
  const lessonRows = (lessonData ?? []) as LessonRow[];

  // 2. Quizzes for the class — counted per lesson_id (archived excluded, matching the library list).
  const { data: quizData } = await admin.from('quizzes')
    .select('id, lesson_id')
    .eq('class_id', classId)
    .neq('status', 'archived');
  const quizRows = (quizData ?? []) as QuizRow[];
  const quizCount = new Map<string, number>();
  for (const q of quizRows) {
    if (!q.lesson_id) continue;
    quizCount.set(q.lesson_id, (quizCount.get(q.lesson_id) ?? 0) + 1);
  }

  const lessons: LessonLibRow[] = lessonRows
    .map((l) => ({
      id: l.id,
      title: l.title ?? 'Untitled lesson',
      subject: l.subject ?? null,
      grade_level: l.grade_level ?? null,
      status: l.status ?? 'draft',
      quiz_count: quizCount.get(l.id) ?? 0,
      created_at: l.created_at ?? '',
    }))
    // Newest-first — the query already orders, but sort in JS too so the result is
    // deterministic regardless of DB row order (mirrors loadGradebook's JS-side ordering).
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return { class_id: classId, lessons };
}
