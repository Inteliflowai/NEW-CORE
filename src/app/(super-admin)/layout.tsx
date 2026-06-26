// Route-group layout for the super-admin role.
// Sets data-role="super-admin" + data-intensity="calm" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';
import { requireRole } from '@/lib/auth/requireRole';

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(['platform_admin']);
  const nav = (
    <>
      <a href="/provision" className="text-fg hover:text-brand px-3 py-1">Provision</a>
      <a href="/schools" className="text-fg hover:text-brand px-3 py-1">Schools</a>
    </>
  );

  return (
    <RoleLayout role="super-admin" nav={nav}>
      {children}
    </RoleLayout>
  );
}
