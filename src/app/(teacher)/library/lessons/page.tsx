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
import { LessonLibrary } from './_components/LessonLibrary';

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

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Lesson Library" kicker="Your lessons" accent="brand" />
      <LessonLibrary data={data} classes={classes} />
    </div>
  );
}
