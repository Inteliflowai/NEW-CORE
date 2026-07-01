// Route-group layout for the parent role.
// Sets data-role="parent" + data-intensity="calm" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';
import { requireRole } from '@/lib/auth/requireRole';
import { HelpButton } from '@/components/core/HelpButton';

export default async function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(['parent']);
  const nav = (
    <>
      <a href="/parent/dashboard" className="text-fg hover:text-brand px-3 py-1">
        Dashboard
      </a>
      <a href="/parent/progress" className="text-fg hover:text-brand px-3 py-1">
        Progress
      </a>
      <a href="/parent/reports" className="text-fg hover:text-brand px-3 py-1">
        Reports
      </a>
    </>
  );

  return (
    <>
      <RoleLayout role="parent" nav={nav}>
        {children}
      </RoleLayout>
      <HelpButton />
    </>
  );
}
