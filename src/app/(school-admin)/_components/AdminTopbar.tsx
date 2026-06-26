'use client';

// src/app/(school-admin)/_components/AdminTopbar.tsx
// Mirrors TeacherTopbar exactly: menu button, pageTitleFor from adminNavConfig,
// client-only greeting (#418 fix), avatar/initials.
// Reuses role-agnostic helpers initialsOf + greetingFor from TeacherTopbar.

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { IconMenu } from '@/components/core/icons';
import { initialsOf, greetingFor } from '@/app/(teacher)/_components/TeacherTopbar';
import { pageTitleFor } from './adminNavConfig';

export function AdminTopbar({
  userName,
  avatarUrl,
  onMenuClick,
}: {
  userName: string | null;
  avatarUrl?: string | null;
  onMenuClick: () => void;
}) {
  const pathname = usePathname();
  const title = pageTitleFor(pathname);
  const initials = initialsOf(userName);
  // #418 fix: compute greeting client-only after mount to avoid hydration mismatch.
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => { setGreeting(greetingFor(new Date().getHours())); }, []);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-fg-muted/15 bg-surface px-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="grid size-9 place-items-center rounded-full border border-fg-muted/20 text-fg-muted lg:hidden"
        >
          <IconMenu className="size-5" />
        </button>
        <span className="text-sm font-semibold text-fg">{title}</span>
      </div>
      <div className="flex items-center gap-3.5">
        {userName && (
          <span className="hidden text-sm text-fg-muted sm:inline">
            {greeting ? <>{greeting}, </> : null}<b className="font-semibold text-fg">{userName}</b>
          </span>
        )}
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-full border border-fg-muted/20 font-bold text-fg-muted"
        >
          ?
        </span>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            aria-hidden
            className="size-9 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold text-fg-on-brand"
          >
            {initials}
          </span>
        )}
      </div>
    </header>
  );
}

export default AdminTopbar;
