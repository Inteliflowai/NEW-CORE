// src/app/(teacher)/_components/TeacherSidebar.tsx
// The Pop-Art rail: logo plate → Active class block → sectioned nav → user + sign-out.
// Token-only styling (sidebar-* tokens from globals.css); decorative texture/glow
// come from the .sidebar-dots / .sidebar-glow utilities.

import Image from 'next/image';
import { ClassSwitcherPill } from './ClassSwitcherPill';
import { SidebarNav } from './SidebarNav';
import { IconSignOut } from '@/components/core/icons';
import { initialsOf } from './TeacherTopbar';

export function TeacherSidebar({ userName }: { userName: string | null }) {
  const initials = initialsOf(userName);
  return (
    <div className="sidebar-glow relative flex h-full flex-col overflow-hidden border-r-[3px] border-sidebar-edge bg-sidebar">
      <div className="sidebar-dots pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative z-[1] flex h-full flex-col">
        {/* Logo plate */}
        <div className="flex justify-center px-4 pt-5 pb-3">
          <div className="inline-flex items-center justify-center rounded-xl bg-sidebar-plate px-3.5 py-2 shadow-sticker">
            <Image
              src="/images/brand/core-logo-white.png"
              alt="CORE"
              width={1700}
              height={760}
              priority
              className="h-14 w-auto"
            />
          </div>
        </div>

        {/* Active class */}
        <div className="px-4 pb-3">
          <ClassSwitcherPill />
        </div>

        {/* Nav */}
        <SidebarNav />

        {/* Footer: user + sign out */}
        <div className="flex flex-col gap-2 border-t border-sidebar-fg/20 p-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-sidebar-fg/15 px-2.5 py-2">
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-full bg-sidebar-plate text-sm font-bold text-brand"
            >
              {initials}
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-bold text-sidebar-fg">{userName ?? 'Teacher'}</span>
              <span className="text-[11px] text-sidebar-fg-muted">Teacher</span>
            </span>
          </div>
          <form method="post" action="/logout">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-edge bg-sidebar-danger px-3 py-2 text-sm font-bold text-fg-on-brand shadow-sticker"
            >
              <IconSignOut className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default TeacherSidebar;
