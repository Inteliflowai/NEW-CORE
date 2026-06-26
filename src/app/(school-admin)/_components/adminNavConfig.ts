// src/app/(school-admin)/_components/adminNavConfig.ts
// Single source of truth for the school-admin nav. Role-aware: the Student-Attention
// entry appears ONLY when the caller has the pedagogy capability (academic head /
// platform_admin). Reuses existing core icons.

export type AdminNavIconKey = 'overview' | 'teachers' | 'classes' | 'analytics' | 'reports' | 'students';

export interface AdminNavItem {
  label: string;
  href: string;
  icon: AdminNavIconKey;
  alsoActiveWhen?: string[];
}

export interface AdminNavGroup {
  groupLabel: string;
  items: AdminNavItem[];
}

export type AdminNavEntry = AdminNavItem | AdminNavGroup;

export function isGroup(e: AdminNavEntry): e is AdminNavGroup {
  return 'items' in e;
}

export function adminNavEntries(canSeeStudentAttention: boolean): AdminNavEntry[] {
  const insight: AdminNavItem[] = [
    { label: 'Analytics', href: '/admin/analytics', icon: 'analytics' },
    { label: 'Reports', href: '/admin/reports', icon: 'reports' },
  ];
  if (canSeeStudentAttention) {
    insight.push({ label: 'Student Attention', href: '/admin/students', icon: 'students' });
  }
  return [
    { label: 'Overview', href: '/admin/overview', icon: 'overview' },
    {
      groupLabel: 'SCHOOL',
      items: [
        { label: 'Teachers', href: '/admin/teachers', icon: 'teachers' },
        { label: 'Classes & Roster', href: '/admin/classes', icon: 'classes', alsoActiveWhen: ['/admin/classes'] },
      ],
    },
    { groupLabel: 'INSIGHT', items: insight },
  ];
}

const TITLE_MAP: Array<[string, string]> = [
  ['/admin/overview', 'Overview'],
  ['/admin/teachers', 'Teachers'],
  ['/admin/classes', 'Classes & Roster'],
  ['/admin/analytics', 'Analytics'],
  ['/admin/reports', 'Reports'],
  ['/admin/students', 'Student Attention'],
];

export function pageTitleFor(pathname: string): string {
  const hit = TITLE_MAP.find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  return hit ? hit[1] : 'CORE';
}

export function matchActive(pathname: string, href: string, alsoActiveWhen?: string[]): boolean {
  if (pathname === href || pathname.startsWith(href + '/')) return true;
  return (alsoActiveWhen ?? []).some((p) => pathname === p || pathname.startsWith(p + '/'));
}
