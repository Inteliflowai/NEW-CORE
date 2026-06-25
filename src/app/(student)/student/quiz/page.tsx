// src/app/(student)/student/quiz/page.tsx
// Thin server component — gates auth, resolves userId/schoolId/tier/firstName,
// then hands off to the 'use client' QuizRunner.
//
// Four-audience: student surface. No scores, no risk, no CL verbs.
// Auth chain: requireRole(['student']) → { userId, schoolId, fullName }.
// Identity is public.users (there is NO students table); grade_level is text.
import React from 'react';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { gradeTextToTier } from '@/lib/quiz/gradeTextToTier';
import { QuizRunner } from './_components/QuizRunner';

export default async function StudentQuizPage({
  searchParams,
}: {
  // ?quizId= arrives from the Google Classroom silent-SSO deep-link (Seg 4) so the student lands on
  // the EXACT published quiz. The student-quiz route re-gates published + active-enrollment.
  searchParams: Promise<{ quizId?: string }>;
}): Promise<React.JSX.Element> {
  const { quizId } = await searchParams;
  // requireRole already returns schoolId + fullName from public.users.
  const { userId, schoolId, fullName } = await requireRole(['student']);
  const firstName = (fullName ?? '').trim().split(/\s+/)[0] || null;

  // The only thing not already in the auth context is grade_level (text).
  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from('users')
    .select('grade_level')
    .eq('id', userId)
    .maybeSingle();

  const gradeLevel = (profile as { grade_level?: string | null } | null)?.grade_level ?? null;
  const tier = gradeTextToTier(gradeLevel); // 'elementary' | 'middle' | 'high'

  return (
    <QuizRunner
      userId={userId}
      schoolId={schoolId}
      tier={tier}
      firstName={firstName}
      quizId={quizId ?? null}
    />
  );
}
