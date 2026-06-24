// src/app/(teacher)/upload/page.tsx
// Retired: authoring has moved into the Lesson Library (/library/lessons) behind the "＋ Create"
// toggle. This page now permanently redirects, preserving the ?class= param so deep-links still
// land on the correct class context. The ContentStudioTabs component and its children (UploadStudio,
// UrlImportStudio, GenerateLessonStudio) are retained — they are imported by LessonLibraryWithCreate.

import { redirect } from 'next/navigation';

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}): Promise<never> {
  const { class: classId } = await searchParams;
  redirect(classId ? `/library/lessons?class=${classId}` : '/library/lessons');
}
