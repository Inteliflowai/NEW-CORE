// Route-group layout for the student role.
// Sets data-role="student" + data-intensity="loud" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';
import { requireRole } from '@/lib/auth/requireRole';
import { HelpButton } from '@/components/core/HelpButton';

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(['student']);
  const nav = (
    <>
      <a href="/student/dashboard" className="text-fg hover:text-brand px-3 py-1">Dashboard</a>
      <a href="/student/assignments" className="text-fg hover:text-brand px-3 py-1">Assignments</a>
      <a href="/student/notes" className="text-fg hover:text-brand px-3 py-1">My Notes</a>
      <a href="/student/growth" className="text-fg hover:text-brand px-3 py-1">How I&apos;m doing</a>
    </>
  );

  return (
    <>
      <RoleLayout role="student" nav={nav}>
        {children}
      </RoleLayout>
      <HelpButton />
    </>
  );
}
