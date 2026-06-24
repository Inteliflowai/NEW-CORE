// src/app/(teacher)/_components/navConfig.ts
// Single source of truth for the teacher sidebar nav: the entries, the group
// structure, and the pure active-route matcher. Shared by SidebarNav and tests.
//
// Destinations are identical to the legacy TeacherNav (9 links); the grouping
// (CLASS / LIBRARY / INSIGHTS & TOOLS) follows the approved Pop-Art mockup.

export type NavIconKey =
  | 'today'
  | 'challenges'
  | 'roster'
  | 'gradebook'
  | 'alerts'
  | 'highFive'
  | 'lessons'
  | 'quizzes'
  | 'insights'
  | 'upload'
  | 'googleClassroom';

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
  /** Extra pathname prefixes that also mark this item active (beyond href itself). */
  alsoActiveWhen?: string[];
  badgeKey?: 'alerts';
}

export interface NavGroup {
  groupLabel: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export function isGroup(e: NavEntry): e is NavGroup {
  return 'groupLabel' in e;
}

export const NAV_ENTRIES: NavEntry[] = [
  { label: 'Today', href: '/today', icon: 'today' },
  { label: 'Spark Challenges', href: '/challenges', icon: 'challenges' },
  {
    groupLabel: 'CLASS',
    items: [
      { label: 'Roster', href: '/roster', icon: 'roster', alsoActiveWhen: ['/students'] },
      { label: 'Gradebook', href: '/gradebook', icon: 'gradebook' },
      { label: 'Alerts', href: '/alerts', icon: 'alerts', badgeKey: 'alerts' },
      { label: 'High Fives', href: '/high-fives', icon: 'highFive' },
    ],
  },
  {
    groupLabel: 'LIBRARY',
    items: [
      { label: 'Lesson Library', href: '/library/lessons', icon: 'lessons' },
      { label: 'Quiz Library', href: '/library/quizzes', icon: 'quizzes' },
    ],
  },
  {
    groupLabel: 'INSIGHTS & TOOLS',
    items: [
      { label: 'Insights', href: '/insights', icon: 'insights' },
      { label: 'Import Roster', href: '/import', icon: 'upload' },
    ],
  },
  {
    groupLabel: 'SETTINGS',
    items: [
      { label: 'Google Classroom', href: '/settings/google', icon: 'googleClassroom' },
    ],
  },
];

/** True when `pathname` is `href`, a sub-path of `href`, or matches an alias prefix. */
export function matchActive(pathname: string, href: string, alsoActiveWhen?: string[]): boolean {
  if (pathname === href || pathname.startsWith(href + '/')) return true;
  return (alsoActiveWhen ?? []).some((p) => pathname === p || pathname.startsWith(p + '/'));
}
