// Route-group layout for the super-admin role.
// Sets data-role="super-admin" + data-intensity="calm" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = (
    <>
      <a href="/platform/dashboard" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Dashboard
      </a>
      <a href="/platform/schools" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Schools
      </a>
      <a href="/platform/users" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Users
      </a>
    </>
  );

  return (
    <RoleLayout role="super-admin" nav={nav}>
      {children}
    </RoleLayout>
  );
}
