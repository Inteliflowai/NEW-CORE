// Route-group layout for the school-admin role.
// Sets data-role="admin" + data-intensity="calm" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';
import { requireRole } from '@/lib/auth/requireRole';
import { SCHOOL_ADMIN_ROLES } from '@/lib/auth/roles';

export default async function SchoolAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(SCHOOL_ADMIN_ROLES);
  // Only /admin/dashboard exists today; School + Teachers pages aren't built yet (don't ship dead links).
  const nav = (
    <a href="/admin/dashboard" className="text-fg hover:text-brand px-3 py-1">Dashboard</a>
  );

  return (
    <RoleLayout role="admin" nav={nav}>
      {children}
    </RoleLayout>
  );
}
