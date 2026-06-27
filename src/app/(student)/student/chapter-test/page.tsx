// src/app/(student)/student/chapter-test/page.tsx
//
// Server component — guards auth + verifies the chapter test is published and
// the student is actively enrolled, then mounts ChapterTestPlayer.
//
// Auth chain:
//   requireRole(['student']) → { userId }          (handles auth, role, trial-expiry)
//   admin.from('chapter_tests') …                  (published guard)
//   admin.from('enrollments')   …                  (enrollment guard)
//
// No client state here — all interactivity lives in ChapterTestPlayer.

import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { ChapterTestPlayer } from './_components/ChapterTestPlayer';

type ChapterTestRow = {
  id: string;
  status: string;
  class_id: string;
};

export default async function ChapterTestPage({
  searchParams,
}: {
  searchParams: Promise<{ chapterTestId?: string }>;
}): Promise<React.JSX.Element> {
  // ── 1. Extract query param ──────────────────────────────────────────────────
  const { chapterTestId } = await searchParams;
  if (!chapterTestId) redirect('/student/assignments');

  // ── 2. Auth + role gate ────────────────────────────────────────────────────
  // requireRole redirects on: no session, wrong role, expired trial
  const { userId } = await requireRole(['student']);

  const admin = createAdminSupabaseClient();

  // ── 3. Chapter test must be published ──────────────────────────────────────
  const { data: testData } = await admin
    .from('chapter_tests')
    .select('id, status, class_id')
    .eq('id', chapterTestId)
    .maybeSingle();

  const test = testData as ChapterTestRow | null;
  if (!test || test.status !== 'published') redirect('/student/assignments');

  // ── 4. Student must be actively enrolled in the test's class ───────────────
  const { data: enrollment } = await admin
    .from('enrollments')
    .select('id')
    .eq('class_id', test.class_id)
    .eq('student_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (!enrollment) redirect('/student/assignments');

  // ── 5. Render ───────────────────────────────────────────────────────────────
  return <ChapterTestPlayer chapterTestId={chapterTestId} userId={userId} />;
}
