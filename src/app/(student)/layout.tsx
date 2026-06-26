// Route-group layout for the student role.
// Sets data-role="student" + data-intensity="loud" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';
import { requireRole } from '@/lib/auth/requireRole';

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(['student']);
  // /student/growth has no page yet — omit it rather than ship a dead link.
  const nav = (
    <>
      <a href="/student/dashboard" className="text-fg hover:text-brand px-3 py-1">Dashboard</a>
      <a href="/student/assignments" className="text-fg hover:text-brand px-3 py-1">Assignments</a>
    </>
  );

  return (
    <RoleLayout role="student" nav={nav}>
      {children}
    </RoleLayout>
  );
}
