'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { TeacherSidebar } from './TeacherSidebar';
import { TeacherTopbar } from './TeacherTopbar';

export function TeacherShell({
  userName,
  children,
}: {
  userName: string | null;
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
      {/* Static rail on lg+ */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <TeacherSidebar userName={userName} />
      </aside>

      {/* Mobile drawer + backdrop */}
      {open && (
        <div
          data-testid="drawer-backdrop"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-fg/50 lg:hidden"
          aria-hidden
        />
      )}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 w-64 transition-transform lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <TeacherSidebar userName={userName} />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TeacherTopbar userName={userName} onMenuClick={() => setOpen((o) => !o)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

export default TeacherShell;
