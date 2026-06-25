// src/app/(teacher)/gradebook/page.tsx
// Server Component — async. Teacher-only (the (teacher) layout already gates
// requireRole(['teacher'])). Mirrors the verified Today/Roster pattern exactly
// (roster/page.tsx:70-96): resolve classId → first-class redirect → IDOR guard
// → admin client (RLS-bypassed) → loadGradebook. The guard is the ONLY IDOR
// backstop. The page-level requireRole(['teacher']) is the redundant-safety +
// userId-source pattern (matches Today/Roster); do NOT optimize it away.
// Token-only styling; deep-ink content text. The shell's <main> already carries
// pop-canvas — do NOT re-apply it here.

import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadGradebook } from '@/lib/gradebook/loadGradebook';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { GradebookGrid } from './_components/GradebookGrid';
import { DiagnosticChecksSection } from './_components/DiagnosticChecksSection';

const NO_CLASSES = (
  <EmptyState variant="just-getting-started" titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, your gradebook appears here." />
);
const CLASS_UNAVAILABLE = (
  <EmptyState variant="just-getting-started" titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes." />
);

export default async function GradebookPage({
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
    redirect(`/gradebook?class=${firstId}`);
  }

  // 2. IDOR guard — teacher must own the class
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  // 3. Load via admin client (RLS-bypassed; guard above is the backstop)
  const admin = createAdminSupabaseClient();
  const { userId } = await requireRole(['teacher']); // also the layout gate; gives teacherId
  const data = await loadGradebook(admin, { classId, teacherId: userId });

  // 4. Google Classroom gating data (C3 — admin-client reads, never RLS).
  //    googleCourseId: whether this class is linked to a GC course.
  //    publishedLessonIds: lesson_ids that have been published as GC courseWork (for this class).
  const [{ data: cls }, { data: pubs }] = await Promise.all([
    admin.from('classes').select('google_course_id').eq('id', classId).maybeSingle(),
    admin.from('google_publications')
      .select('resource_id')
      .eq('class_id', classId)
      .eq('resource_type', 'assignment'),
  ]);
  const googleCourseId: string | null = (cls as { google_course_id: string | null } | null)?.google_course_id ?? null;
  const publishedLessonIds: string[] = ((pubs ?? []) as Array<{ resource_id: string | null }>)
    .map((p) => p.resource_id)
    .filter((id): id is string => id != null);

  // 4. Cold-start
  if (data.students.length === 0) {
    return (
      <div className="p-5 flex flex-col gap-5">
        <PageHeader title="Gradebook" kicker="Where the class stands" accent="brand" />
        <EmptyState variant="just-getting-started" />
      </div>
    );
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Gradebook" kicker="Where the class stands" accent="brand" />
      <GradebookGrid data={data} googleCourseId={googleCourseId} publishedLessonIds={publishedLessonIds} />
      <DiagnosticChecksSection data={data} />
    </div>
  );
}
