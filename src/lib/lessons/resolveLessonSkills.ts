// src/lib/lessons/resolveLessonSkills.ts
// A lesson's skills = the distinct skills tagged on its quizzes' questions
// (lessons have no direct skill column). Used to scope per-skill CL for assignment
// generation. Returns [] for an untagged lesson → callers fall back to single-band.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function resolveLessonSkills(
  admin: SupabaseClient,
  lessonId: string,
): Promise<{ skill_id: string; skill_name: string }[]> {
  const { data: quizRows } = await admin.from('quizzes').select('id').eq('lesson_id', lessonId);
  const quizIds = ((quizRows ?? []) as { id: string }[]).map((q) => q.id);
  if (quizIds.length === 0) return [];

  const { data: qRows } = await admin
    .from('quiz_questions')
    .select('skill_id, skills(id, name)')
    .in('quiz_id', quizIds)
    .not('skill_id', 'is', null);

  const seen = new Map<string, string>();
  for (const row of (qRows ?? []) as unknown as { skill_id: string | null; skills: { id: string; name: string } | null }[]) {
    if (row.skill_id && row.skills && !seen.has(row.skill_id)) {
      seen.set(row.skill_id, row.skills.name);
    }
  }
  return [...seen.entries()].map(([skill_id, skill_name]) => ({ skill_id, skill_name }));
}
