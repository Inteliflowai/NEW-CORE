// Route-group layout for the teacher role.
// Sets data-role="teacher" + data-intensity="calm" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';
import { requireRole } from '@/lib/auth/requireRole';
import { TeacherNav } from './_components/TeacherNav';
import { ClassSwitcherPill } from './_components/ClassSwitcherPill';

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(['teacher']);
  return (
    <RoleLayout
      role="teacher"
      nav={
        <>
          <TeacherNav />
          <ClassSwitcherPill />
        </>
      }
    >
      {children}
    </RoleLayout>
  );
}
