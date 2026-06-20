'use client';

import { usePathname } from 'next/navigation';
import { IconMenu } from '@/components/core/icons';

const TITLE_MAP: Array<[string, string]> = [
  ['/today', 'Today'],
  ['/roster', 'Roster'],
  ['/students', 'Student'],
  ['/gradebook', 'Gradebook'],
  ['/alerts', 'Alerts'],
  ['/high-fives', 'High Fives'],
  ['/library/lessons', 'Lesson Library'],
  ['/library/quizzes', 'Quiz Library'],
  ['/insights', 'Insights'],
  ['/upload', 'Upload'],
];

export function pageTitleFor(pathname: string): string {
  const hit = TITLE_MAP.find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  return hit ? hit[1] : 'CORE';
}

export function initialsOf(name: string | null): string {
  if (!name) return 'T';
  const parts = name.replace(/[^\p{L}\s.]/gu, '').split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return letters || 'T';
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function TeacherTopbar({
  userName,
  onMenuClick,
}: {
  userName: string | null;
  onMenuClick: () => void;
}) {
  const pathname = usePathname();
  const title = pageTitleFor(pathname);
  const initials = initialsOf(userName);
  const greeting = greetingFor(new Date().getHours());

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
            {greeting}, <b className="font-semibold text-fg">{userName}</b>
          </span>
        )}
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-full border border-fg-muted/20 font-bold text-fg-muted"
        >
          ?
        </span>
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold text-fg-on-brand"
        >
          {initials}
        </span>
      </div>
    </header>
  );
}

export default TeacherTopbar;
