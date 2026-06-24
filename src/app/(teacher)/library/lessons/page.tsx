// src/app/(teacher)/library/lessons/page.tsx
// Server Component — async. Teacher-only (the (teacher) layout gates requireRole(['teacher'])).
// Mirrors the verified Gradebook/Today/Roster page pattern: resolve classId → first-class
// redirect → IDOR guard → admin client (RLS-bypassed; the guard is the ONLY IDOR backstop) →
// loadLessonLibrary. Token-only styling; deep-ink content text. The shell's <main> already
// carries pop-canvas — do NOT re-apply it here.

import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadLessonLibrary } from '@/lib/lessons/loadLessonLibrary';
import { teacherClassOptions } from '@/lib/teacher/teacherClasses';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../../_components/PageHeader';
import { LessonLibraryWithCreate } from './_components/LessonLibraryWithCreate';
import type { UploadLessonLite } from '../../upload/_components/UploadStudio';

type LessonLiteRow = {
  id: string;
  title: string | null;
  status: string | null;
  parsed_content: { key_concepts?: unknown } | null;
};

const NO_CLASSES = (
  <EmptyState variant="just-getting-started" titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, your lessons appear here." />
);
const CLASS_UNAVAILABLE = (
  <EmptyState variant="just-getting-started" titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes." />
);

export default async function LessonLibraryPage({
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
    redirect(`/library/lessons?class=${firstId}`);
  }

  // 2. IDOR guard — teacher must own the class.
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  // 3. Load via admin client (RLS-bypassed; the guard above is the backstop).
  //    teacherClassOptions is scoped to userId, so it only surfaces this teacher's own classes.
  const admin = createAdminSupabaseClient();
  const [data, classes] = await Promise.all([
    loadLessonLibrary(admin, { classId }),
    teacherClassOptions(admin, userId),
  ]);

  // 4. Existing lessons-lite for the fuzzy duplicate check inside ContentStudioTabs (lifted from
  //    /upload/page.tsx). Archived lessons excluded; concept_tags come from parsed_content.
  const { data: lessonData } = await admin.from('lessons')
    .select('id, title, status, parsed_content')
    .eq('class_id', classId)
    .neq('status', 'archived');

  const existingLessons: UploadLessonLite[] = ((lessonData ?? []) as LessonLiteRow[]).map((l) => {
    const raw = l.parsed_content?.key_concepts;
    const concept_tags = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
    return { id: l.id, title: l.title, concept_tags, status: l.status ?? 'draft' };
  });

  // 5. School state (for the Generate tab's standards suggestions). Null when unset.
  let schoolState: string | null = null;
  const { data: classRow } = await admin.from('classes').select('school_id').eq('id', classId).maybeSingle();
  const schoolId = (classRow as { school_id?: string | null } | null)?.school_id ?? null;
  if (schoolId) {
    const { data: school } = await admin.from('schools').select('state').eq('id', schoolId).maybeSingle();
    schoolState = (school as { state?: string | null } | null)?.state ?? null;
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Lesson Library" kicker="Your lessons" accent="brand" />
      <LessonLibraryWithCreate
        data={data}
        classes={classes}
        classId={classId}
        existingLessons={existingLessons}
        schoolState={schoolState}
      />
    </div>
  );
}
