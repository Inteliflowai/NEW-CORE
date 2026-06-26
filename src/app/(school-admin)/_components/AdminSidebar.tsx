'use client';

// src/app/(school-admin)/_components/AdminSidebar.tsx
// Pop-Art admin rail: logo plate → sectioned nav → user + sign-out.
// Mirrors TeacherSidebar but strips ClassSwitcherPill and the SPARK sticker block.
// Nav is role-aware (Student-Attention gated by canSeeStudentAttention).

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { adminNavEntries, matchActive, isGroup, type AdminNavItem, type AdminNavIconKey } from './adminNavConfig';
import {
  IconInsights, IconRoster, IconLessons, IconHighFive, IconSignOut,
} from '@/components/core/icons';
import { initialsOf } from '@/app/(teacher)/_components/TeacherTopbar';

const ICON: Record<AdminNavIconKey, (p: { className?: string }) => React.JSX.Element> = {
  overview: IconInsights,
  teachers: IconRoster,
  classes: IconRoster,
  analytics: IconInsights,
  reports: IconLessons,
  students: IconHighFive,
};

function AdminNavLink({ item }: { item: AdminNavItem }) {
  const pathname = usePathname();
  const active = matchActive(pathname, item.href, item.alsoActiveWhen);
  const Icon = ICON[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={[
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
        active
          ? 'bg-sidebar-active text-sidebar-active-fg shadow-sticker'
          : 'text-sidebar-fg hover:bg-sidebar-fg/15',
      ].join(' ')}
    >
      <Icon className="size-[18px] shrink-0" />
      {item.label}
    </Link>
  );
}

export function AdminSidebar({
  userName,
  avatarUrl,
  roleLabel,
  canSeeStudentAttention,
}: {
  userName: string | null;
  avatarUrl?: string | null;
  roleLabel: string;
  canSeeStudentAttention: boolean;
}) {
  const initials = initialsOf(userName);
  const entries = adminNavEntries(canSeeStudentAttention);

  return (
    <div className="sidebar-glow relative flex h-full flex-col overflow-hidden border-r-[3px] border-sidebar-edge bg-sidebar">
      <div className="sidebar-dots pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative z-[1] flex h-full flex-col">
        {/* Logo plate */}
        <div className="flex justify-center px-4 pt-4 pb-2">
          <div className="inline-flex items-center justify-center rounded-xl bg-sidebar-plate px-3 py-1.5 shadow-sticker">
            <Image
              src="/images/brand/core-logo-white.png"
              alt="CORE"
              width={1700}
              height={760}
              priority
              className="h-10 w-auto"
            />
          </div>
        </div>

        {/* Nav */}
        <nav aria-label="Admin navigation" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
          {entries.map((entry) =>
            isGroup(entry) ? (
              <div key={entry.groupLabel} className="flex flex-col gap-1">
                <span className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-sidebar-fg-muted">
                  {entry.groupLabel}
                </span>
                {entry.items.map((i) => (
                  <AdminNavLink key={i.href} item={i} />
                ))}
              </div>
            ) : (
              <AdminNavLink key={entry.href} item={entry} />
            ),
          )}
        </nav>

        {/* Footer: user (→ /profile) + sign out */}
        <div className="flex flex-col gap-1.5 border-t border-sidebar-fg/20 p-2.5">
          <Link
            href="/profile"
            className="flex items-center gap-2.5 rounded-xl bg-sidebar-fg/15 px-2.5 py-2 hover:bg-sidebar-fg/25"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                aria-hidden
                className="size-8 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="grid size-8 place-items-center rounded-full bg-sidebar-plate text-sm font-bold text-brand"
              >
                {initials}
              </span>
            )}
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-bold text-sidebar-fg">{userName ?? roleLabel}</span>
              <span className="text-[11px] text-sidebar-fg-muted">{roleLabel}</span>
            </span>
          </Link>
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

export default AdminSidebar;
