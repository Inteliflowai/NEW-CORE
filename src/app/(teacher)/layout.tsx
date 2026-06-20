// Route-group layout for the teacher role.
// Auth gate (requireRole) first, then the left-sidebar app shell (TeacherShell),
// which sets data-role="teacher" + data-intensity="calm" for token binding.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { TeacherShell } from './_components/TeacherShell';
import { requireRole } from '@/lib/auth/requireRole';

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { fullName } = await requireRole(['teacher']);
  return <TeacherShell userName={fullName}>{children}</TeacherShell>;
}
