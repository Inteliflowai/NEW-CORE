// src/app/(teacher)/library/quizzes/page.tsx
// Server Component — async. Teacher-only (the (teacher) layout already gates
// requireRole(['teacher'])). Follows the Global-Constraints page pattern exactly
// (gradebook/page.tsx): resolve classId → first-class redirect → IDOR guard →
// admin client (RLS-bypassed; the guard is the ONLY IDOR backstop) → loadQuizLibrary.
// Token-only styling; deep-ink content text. The shell's <main> already carries
// pop-canvas — do NOT re-apply it here.

import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadQuizLibrary } from '@/lib/quizzes/loadQuizLibrary';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../../_components/PageHeader';
import { QuizLibrary, type QuizQuestionLite } from './_components/QuizLibrary';

const NO_CLASSES = (
  <EmptyState variant="just-getting-started" titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, your checks appear here." />
);
const CLASS_UNAVAILABLE = (
  <EmptyState variant="just-getting-started" titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes." />
);

type QqRow = { id: string; quiz_id: string; position: number | null; question_type: string; question_text: string; choices: string[] | null; rubric: string | null };

export default async function QuizLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}): Promise<React.JSX.Element> {
  // 1. Resolve classId — default to the teacher's first class when absent.
  const { class: classId } = await searchParams;
  if (!classId) {
    const { userId } = await requireRole(['teacher']);
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) return <div className="p-6">{NO_CLASSES}</div>;
    redirect(`/library/quizzes?class=${firstId}`);
  }

  // 2. IDOR guard — teacher must own the class.
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  // 3. Load via admin client (RLS-bypassed; the guard above is the backstop).
  const admin = createAdminSupabaseClient();
  const data = await loadQuizLibrary(admin, { classId });

  // 3b. Fetch the questions for the (non-archived) quizzes so the edit panel can edit them
  // without a second round-trip. Scoped to the class's quizzes only.
  const quizIds = data.quizzes.map((q) => q.id);
  const questions: Record<string, QuizQuestionLite[]> = {};
  if (quizIds.length > 0) {
    const { data: qqData } = await admin.from('quiz_questions')
      .select('id, quiz_id, position, question_type, question_text, choices, rubric')
      .in('quiz_id', quizIds)
      .order('position', { ascending: true });
    for (const r of ((qqData ?? []) as QqRow[])) {
      (questions[r.quiz_id] ??= []).push({
        id: r.id,
        position: r.position ?? 0,
        question_type: r.question_type,
        question_text: r.question_text,
        choices: Array.isArray(r.choices) ? r.choices : null,
        rubric: r.rubric ?? null,
      });
    }
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Quiz Library" kicker="Your checks" accent="brand" />
      <QuizLibrary data={data} classId={classId} questions={questions} />
    </div>
  );
}
