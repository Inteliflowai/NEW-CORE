// Route-group layout for the teacher role.
// Sets data-role="teacher" + data-intensity="calm" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';
import { TeacherNav } from './_components/TeacherNav';
import { ClassSwitcherPill } from './_components/ClassSwitcherPill';

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
