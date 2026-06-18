// Route-group layout for the parent role.
// Sets data-role="parent" + data-intensity="calm" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';

export default function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nav = (
    <>
      <a href="/parent/dashboard" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Dashboard
      </a>
      <a href="/parent/children" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        My Children
      </a>
      <a href="/parent/reports" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Reports
      </a>
    </>
  );

  return (
    <RoleLayout role="parent" nav={nav}>
      {children}
    </RoleLayout>
  );
}
