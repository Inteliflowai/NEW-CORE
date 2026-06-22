// Route-group layout for the teacher role.
// Auth gate (requireRole) first, then the left-sidebar app shell (TeacherShell),
// which sets data-role="teacher" + data-intensity="calm" for token binding.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { TeacherShell } from './_components/TeacherShell';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { openAlertCountForTeacher } from '@/lib/alerts/openAlertCount';

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { fullName, userId } = await requireRole(['teacher']);
  const admin = createAdminSupabaseClient();
  const alertCount = await openAlertCountForTeacher(admin, userId);
  return <TeacherShell userName={fullName} alertCount={alertCount}>{children}</TeacherShell>;
}
