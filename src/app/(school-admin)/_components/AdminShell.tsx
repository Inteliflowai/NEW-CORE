'use client';

// src/app/(school-admin)/_components/AdminShell.tsx
// Mirrors TeacherShell: persistent lg rail + mobile drawer.
// data-role="admin"; passes roleLabel + canSeeStudentAttention to AdminSidebar.
// No alertCount (admin doesn't have the student-alert badge).

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

export function AdminShell({
  userName,
  avatarUrl,
  roleLabel,
  canSeeStudentAttention,
  children,
}: {
  userName: string | null;
  avatarUrl?: string | null;
  roleLabel: string;
  canSeeStudentAttention: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div data-role="admin" data-intensity="calm" className="flex h-screen overflow-hidden bg-bg text-fg">
      {/* Persistent rail on lg+. */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <AdminSidebar
          userName={userName}
          avatarUrl={avatarUrl}
          roleLabel={roleLabel}
          canSeeStudentAttention={canSeeStudentAttention}
        />
      </aside>

      {/* Mobile drawer — mounted ONLY while open. */}
      {open && (
        <>
          <div
            data-testid="drawer-backdrop"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-fg/50 lg:hidden"
            aria-hidden
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 lg:hidden">
            <AdminSidebar
              userName={userName}
              avatarUrl={avatarUrl}
              roleLabel={roleLabel}
              canSeeStudentAttention={canSeeStudentAttention}
            />
          </aside>
        </>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar userName={userName} avatarUrl={avatarUrl} onMenuClick={() => setOpen((o) => !o)} />
        <main className="pop-canvas flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

export default AdminShell;
