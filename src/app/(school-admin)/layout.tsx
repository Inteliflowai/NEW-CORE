// Route-group layout for the school-admin role.
// Sets data-role="admin" + data-intensity="calm" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';

export default function SchoolAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = (
    <>
      <a href="/admin/dashboard" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Dashboard
      </a>
      <a href="/admin/school" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        School
      </a>
      <a href="/admin/teachers" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Teachers
      </a>
    </>
  );

  return (
    <RoleLayout role="admin" nav={nav}>
      {children}
    </RoleLayout>
  );
}
