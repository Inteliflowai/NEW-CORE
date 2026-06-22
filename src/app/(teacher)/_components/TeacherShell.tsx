'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { TeacherSidebar } from './TeacherSidebar';
import { TeacherTopbar } from './TeacherTopbar';

export function TeacherShell({
  userName,
  alertCount,
  children,
}: {
  userName: string | null;
  alertCount?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div data-role="teacher" data-intensity="calm" className="flex h-screen overflow-hidden bg-bg text-fg">
      {/* Persistent rail on lg+. Mounts on every viewport (display:none below lg via
          `hidden`), so this single instance owns the class fetch + default ?class=.
          display:none also keeps it out of the a11y tree / tab order on small screens. */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <TeacherSidebar userName={userName} alertCount={alertCount} />
      </aside>

      {/* Mobile drawer — mounted ONLY while open. Mounting on demand avoids a second
          ClassSwitcherPill on load (no double fetch / racing ?class= write) and keeps
          closed-drawer controls out of the tab order / accessibility tree. */}
      {open && (
        <>
          <div
            data-testid="drawer-backdrop"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-fg/50 lg:hidden"
            aria-hidden
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 lg:hidden">
            <TeacherSidebar userName={userName} alertCount={alertCount} />
          </aside>
        </>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TeacherTopbar userName={userName} onMenuClick={() => setOpen((o) => !o)} />
        <main className="pop-canvas flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

export default TeacherShell;
