// src/app/(teacher)/upload/page.tsx
// Server Component — async. Teacher-only (the (teacher) layout already gates requireRole(['teacher'])).
// Follows the Global-Constraints page pattern exactly (gradebook/lesson-library page): resolve
// classId → first-class redirect → IDOR guard → admin client (RLS-bypassed; the guard is the ONLY
// IDOR backstop). It also fetches the teacher's existing lessons-lite (title + parsed_content
// key_concepts, archived excluded) so UploadStudio can run the pure fuzzy duplicate check client-side
// BEFORE drafting a quiz. Token-only styling; deep-ink content text. The shell's <main> already
// carries pop-canvas — do NOT re-apply it here.

import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { UploadStudio, type UploadLessonLite } from './_components/UploadStudio';

const NO_CLASSES = (
  <EmptyState variant="just-getting-started" titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, you can upload lessons here." />
);
const CLASS_UNAVAILABLE = (
  <EmptyState variant="just-getting-started" titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes." />
);

type LessonLiteRow = {
  id: string;
  title: string | null;
  status: string | null;
  parsed_content: { key_concepts?: unknown } | null;
};

export default async function UploadPage({
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
    redirect(`/upload?class=${firstId}`);
  }

  // 2. IDOR guard — teacher must own the class.
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  // 3. Existing lessons-lite for the fuzzy duplicate check (archived excluded). Admin client is
  //    RLS-bypassed; the guard above is the backstop. concept_tags come from parsed_content
  //    (lessons are only fuzzy-matchable once parsed; un-parsed rows contribute an empty tag set).
  const admin = createAdminSupabaseClient();
  const { data: lessonData } = await admin.from('lessons')
    .select('id, title, status, parsed_content')
    .eq('class_id', classId)
    .neq('status', 'archived');

  const existingLessons: UploadLessonLite[] = ((lessonData ?? []) as LessonLiteRow[]).map((l) => {
    const raw = l.parsed_content?.key_concepts;
    const concept_tags = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
    return { id: l.id, title: l.title, concept_tags, status: l.status ?? 'draft' };
  });

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Upload a lesson" kicker="Content Studio" accent="brand" />
      <UploadStudio classId={classId} existingLessons={existingLessons} />
    </div>
  );
}
