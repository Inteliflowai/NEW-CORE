// Route-group layout for the teacher role.
// Sets data-role="teacher" + data-intensity="calm" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = (
    <>
      <a href="/teacher/dashboard" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Dashboard
      </a>
      <a href="/teacher/class" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Class
      </a>
      <a href="/teacher/assignments" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Assignments
      </a>
    </>
  );

  return (
    <RoleLayout role="teacher" nav={nav}>
      {children}
    </RoleLayout>
  );
}
