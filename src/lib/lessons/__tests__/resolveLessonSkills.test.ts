import { describe, it, expect } from 'vitest';
import { resolveLessonSkills } from '@/lib/lessons/resolveLessonSkills';

function admin({ quizzes, questions }: { quizzes: { id: string }[]; questions: { skill_id: string | null; skills: { id: string; name: string } | null }[] }) {
  return {
    from: (table: string) => {
      if (table === 'quizzes') {
        return { select: () => ({ eq: async () => ({ data: quizzes, error: null }) }) };
      }
      // quiz_questions
      return {
        select: () => ({ in: () => ({ not: async () => ({ data: questions, error: null }) }) }),
      };
    },
  } as never;
}

describe('resolveLessonSkills', () => {
  it('returns [] when the lesson has no quizzes', async () => {
    const out = await resolveLessonSkills(admin({ quizzes: [], questions: [] }), 'lesson1');
    expect(out).toEqual([]);
  });
  it('returns distinct skills (deduped, first-seen order) from quiz questions', async () => {
    const out = await resolveLessonSkills(
      admin({
        quizzes: [{ id: 'q1' }],
        questions: [
          { skill_id: 'frac', skills: { id: 'frac', name: 'Fractions' } },
          { skill_id: 'dec', skills: { id: 'dec', name: 'Decimals' } },
          { skill_id: 'frac', skills: { id: 'frac', name: 'Fractions' } }, // dup
          { skill_id: null, skills: null }, // untagged → ignored
        ],
      }),
      'lesson1',
    );
    expect(out).toEqual([
      { skill_id: 'frac', skill_name: 'Fractions' },
      { skill_id: 'dec', skill_name: 'Decimals' },
    ]);
  });
});
