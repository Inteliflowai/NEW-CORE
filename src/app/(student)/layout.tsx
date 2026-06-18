// Route-group layout for the student role.
// Sets data-role="student" + data-intensity="loud" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = (
    <>
      <a href="/student/dashboard" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Dashboard
      </a>
      <a href="/student/assignments" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Assignments
      </a>
      <a href="/student/growth" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Growth
      </a>
    </>
  );

  return (
    <RoleLayout role="student" nav={nav}>
      {children}
    </RoleLayout>
  );
}
