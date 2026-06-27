// src/app/(teacher)/chapters/page.tsx
// Server Component — async. Teacher-only (the (teacher) layout gates requireRole(['teacher'])).
// Mirrors the Gradebook/Lesson Library page pattern: resolve classId → first-class redirect →
// IDOR guard → admin client (RLS-bypassed; guard is the ONLY IDOR backstop) → load data.
// Token-only styling; deep-ink content text.

import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { ChapterList } from './_components/ChapterList';
import type { ChapterRow, LessonRow, ChapterTestRow } from './_components/ChapterList';

const NO_CLASSES = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, your chapters will appear here."
  />
);
const CLASS_UNAVAILABLE = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes."
  />
);

export default async function ChaptersPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}): Promise<React.JSX.Element> {
  // 1. Resolve classId — default to the teacher's first class when absent.
  const { class: classId } = await searchParams;
  const { userId } = await requireRole(['teacher']);

  if (!classId) {
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) return <div className="p-6">{NO_CLASSES}</div>;
    redirect(`/chapters?class=${firstId}`);
  }

  // 2. IDOR guard — teacher must own (or have access to) the class.
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  // 3. Load data via admin client (RLS-bypassed; guard above is the backstop).
  const admin = createAdminSupabaseClient();

  // Chapters for this class (non-archived, ordered by sequence)
  const { data: chaptersRaw } = await admin
    .from('chapters')
    .select('id, class_id, title, description, sequence, created_at, archived_at')
    .eq('class_id', classId)
    .is('archived_at', null)
    .order('sequence');

  // Lesson counts per chapter
  type ChapterSelectRow = {
    id: string;
    class_id: string;
    title: string;
    description: string | null;
    sequence: number;
    created_at: string;
    archived_at: string | null;
  };

  const rawChapters = (chaptersRaw ?? []) as ChapterSelectRow[];
  const chapterIds = rawChapters.map((c) => c.id);
  let lessonCounts: Record<string, number> = {};

  if (chapterIds.length > 0) {
    const { data: lessonCountRows } = await admin
      .from('lessons')
      .select('chapter_id')
      .in('chapter_id', chapterIds);
    for (const l of ((lessonCountRows ?? []) as Array<{ chapter_id: string }>)) {
      lessonCounts[l.chapter_id] = (lessonCounts[l.chapter_id] ?? 0) + 1;
    }
  }

  const chapters: ChapterRow[] = rawChapters.map((c) => ({
    ...c,
    lesson_count: lessonCounts[c.id] ?? 0,
  }));

  // Most-recent non-archived chapter_test per chapter (keyed by chapter_id)
  let chapterTests: Record<string, ChapterTestRow> = {};

  if (chapterIds.length > 0) {
    const { data: testsRaw } = await admin
      .from('chapter_tests')
      .select('id, chapter_id, title, status, generation_status')
      .in('chapter_id', chapterIds)
      .neq('status', 'archived')
      .order('created_at', { ascending: false });

    for (const t of ((testsRaw ?? []) as Array<{
      id: string;
      chapter_id: string;
      title: string;
      status: string;
      generation_status: string;
    }>)) {
      // Take only the first (most recent) per chapter_id — ordered DESC above
      if (!chapterTests[t.chapter_id]) {
        chapterTests[t.chapter_id] = {
          id: t.id,
          title: t.title,
          status: t.status as ChapterTestRow['status'],
          generation_status: t.generation_status as ChapterTestRow['generation_status'],
        };
      }
    }
  }

  // Lessons for this class (with chapter_id for assignment state)
  const { data: lessonsRaw } = await admin
    .from('lessons')
    .select('id, title, chapter_id')
    .eq('class_id', classId)
    .neq('status', 'archived')
    .order('title', { ascending: true });

  const lessons: LessonRow[] = ((lessonsRaw ?? []) as Array<{
    id: string;
    title: string | null;
    chapter_id: string | null;
  }>).map((l) => ({
    id: l.id,
    title: l.title,
    chapter_id: l.chapter_id,
  }));

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader
        title="Chapters"
        kicker="Organise your lessons into units"
        accent="brand"
      />
      <ChapterList classId={classId} chapters={chapters} lessons={lessons} chapterTests={chapterTests} />
    </div>
  );
}
