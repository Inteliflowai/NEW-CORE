'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  label: string;
  href: string;
  /** Extra pathname prefixes that also mark this item active (beyond href itself). */
  alsoActiveWhen?: string[];
}

interface NavGroup {
  groupLabel: string;
  items: NavItem[];
}

type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'groupLabel' in entry;
}

const NAV_ENTRIES: NavEntry[] = [
  { label: 'Today', href: '/today' },
  {
    groupLabel: 'STUDENTS',
    items: [
      { label: 'Roster', href: '/roster', alsoActiveWhen: ['/students'] },
      { label: 'Gradebook', href: '/gradebook' },
      { label: 'Alerts', href: '/alerts' },
      { label: 'High Fives', href: '/high-fives' },
    ],
  },
  {
    groupLabel: 'TEACHER',
    items: [
      { label: 'Lesson Library', href: '/library/lessons' },
      { label: 'Quiz Library', href: '/library/quizzes' },
    ],
  },
  { label: 'Insights', href: '/insights' },
  { label: 'Upload', href: '/upload' },
];

function useIsActive(href: string, alsoActiveWhen?: string[]): boolean {
  const pathname = usePathname();
  if (pathname === href || pathname.startsWith(href + '/')) return true;
  if (alsoActiveWhen) {
    return alsoActiveWhen.some(
      (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
    );
  }
  return false;
}

function NavLink({ item }: { item: NavItem }) {
  const active = useIsActive(item.href, item.alsoActiveWhen);
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'text-brand px-3 py-1'
          : 'text-fg hover:text-brand px-3 py-1'
      }
    >
      {item.label}
    </Link>
  );
}

export function TeacherNav() {
  return (
    <ul className="flex flex-wrap items-center gap-1 list-none m-0 p-0">
      {NAV_ENTRIES.map((entry) => {
        if (isGroup(entry)) {
          return (
            <li key={entry.groupLabel} className="flex items-center gap-1">
              <span className="text-fg-muted text-xs font-semibold uppercase tracking-wider px-2">
                {entry.groupLabel}
              </span>
              {entry.items.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </li>
          );
        }
        return (
          <li key={entry.href}>
            <NavLink item={entry} />
          </li>
        );
      })}
    </ul>
  );
}

export default TeacherNav;
