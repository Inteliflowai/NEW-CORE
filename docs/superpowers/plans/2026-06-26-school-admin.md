# School-Admin Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `(school-admin)` placeholder with a real, role-differentiated admin surface for a customer school's own staff — a pop-art shell + 6 pages, scoped to the admin's own school, with the pedagogy layer gated to the academic head.

**Architecture:** Each page is a server component: `resolveAdminContext()` (wraps `requireRole(SCHOOL_ADMIN_ROLES)`, resolves the effective `schoolId`, computes capabilities) → `createAdminSupabaseClient()` (RLS-bypassed; the guard is the IDOR backstop) → a pure `loadSchool*(admin, schoolId)` loader → presentational components built from the `core/*` kit. The shell mirrors the teacher pop-art shell. The Student-Attention page is capability-gated (nav + a server URL re-guard).

**Tech Stack:** Next.js 16 App Router (async `searchParams`), React 19, TypeScript strict, Tailwind v4 token-only, Vitest 4 (jsdom for components). No new dependency. **No migration.**

## Global Constraints

- **No migration.** All data is queryable today via the admin client scoped by `schoolId` (`schools`, `school_licenses`, `users`, `classes`, `enrollments`, `quizzes`, `assignments`, `homework_attempts`, `alerts`, `high_fives`, `student_model_snapshots`).
- **Role split:** `school_sysadmin` (IT) → operational pages ONLY. `school_admin` (academic head) + `platform_admin` → operational PLUS the Student-Attention pedagogy layer. Gated in nav AND server-side URL re-guard.
- **Four-audience / restraint:** operational pages show COUNTS, never per-student diagnostics. The pedagogy layer is staff-only, **band-level only (NO raw risk numbers)**, and drills into the EXISTING teacher views — do not rebuild a risk dashboard. ≤ a few numbers per card; quiet-when-empty.
- **Scoping:** loaders ALWAYS scope by the resolved `schoolId` (or class→school). Non-platform roles can never override their `schoolId`. `platform_admin` has `schoolId=null` from the guard → resolve via `?school=` or render a "pick a school" empty-state.
- **Token-only** (no hardcoded hex/spacing/arbitrary `[…]`); deep-ink `text-fg`; WCAG-AA. **"Assignments" not "Homework"** in copy. New admin-visible strings → `STRINGS-FOR-BARB.md §School Admin`.
- Gates: `npx tsc --noEmit` 0 · full `npm test` green · `npm run build` 0 (a11y + tokens).

## File structure

- `src/lib/auth/adminCapabilities.ts` (create) — pure `adminCapabilities(role)`.
- `src/lib/school/resolveAdminContext.ts` (create) — `requireRole` + effective schoolId + caps.
- `src/lib/school/{loadSchoolOverview,loadSchoolTeachers,loadSchoolClasses,loadClassRoster,loadSchoolAnalytics,loadSchoolReport,loadStudentAttention}.ts` (create) — pure loaders.
- `src/app/(school-admin)/_components/{AdminShell,AdminSidebar,AdminTopbar,adminNavConfig.ts}` (create) — mirror the teacher shell.
- `src/app/(school-admin)/layout.tsx` (modify) — switch to `AdminShell`.
- `src/app/(school-admin)/admin/dashboard/page.tsx` (modify) — redirect → `/admin/overview`.
- `src/app/(school-admin)/admin/{overview,teachers,classes,analytics,reports,students}/page.tsx` (create) + per-page presentational `_components`.

## Task Dependency & Ordering
1. **Task 1** (auth scaffolding) — no deps.
2. **Task 2** (shell) — needs Task 1 (caps type for nav gating).
3. **Task 3** (layout switch + dashboard redirect) — needs Tasks 1, 2.
4. **Tasks 4–8** (Overview, Teachers, Classes & Roster, Analytics, Reports) — each needs Tasks 1–3; independent of each other.
5. **Task 9** (Student Attention + URL-guard) — needs Tasks 1–3.

---

### Task 1: Auth scaffolding — `adminCapabilities` + `resolveAdminContext`

**Files:**
- Create: `src/lib/auth/adminCapabilities.ts`
- Create: `src/lib/school/resolveAdminContext.ts`
- Test: `src/lib/auth/__tests__/adminCapabilities.test.ts`

**Interfaces:**
- Produces: `adminCapabilities(role: string): { canSeeStudentAttention: boolean }`; `resolveAdminContext(searchParams?: { school?: string }): Promise<{ userId; role; fullName; schoolId: string|null; isPlatform: boolean; caps: { canSeeStudentAttention: boolean } }>`.
- Consumes: `requireRole`, `SCHOOL_ADMIN_ROLES` (`@/lib/auth/{requireRole,roles}`).

- [ ] **Step 1: Write the failing test** — `src/lib/auth/__tests__/adminCapabilities.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { adminCapabilities } from '@/lib/auth/adminCapabilities';

describe('adminCapabilities', () => {
  it('grants student-attention to the academic head + platform admin', () => {
    expect(adminCapabilities('school_admin').canSeeStudentAttention).toBe(true);
    expect(adminCapabilities('platform_admin').canSeeStudentAttention).toBe(true);
  });
  it('denies student-attention to IT (school_sysadmin) and anyone else', () => {
    expect(adminCapabilities('school_sysadmin').canSeeStudentAttention).toBe(false);
    expect(adminCapabilities('teacher').canSeeStudentAttention).toBe(false);
    expect(adminCapabilities('').canSeeStudentAttention).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/__tests__/adminCapabilities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/auth/adminCapabilities.ts`**

```ts
// src/lib/auth/adminCapabilities.ts
// What a customer-school admin role may see. The IT role (school_sysadmin) is
// operational-only; the academic head (school_admin) + platform_admin see the
// student-attention pedagogy layer. (Spec §Roles & capability gating.)
export interface AdminCapabilities {
  canSeeStudentAttention: boolean;
}
export function adminCapabilities(role: string): AdminCapabilities {
  return { canSeeStudentAttention: role === 'school_admin' || role === 'platform_admin' };
}
```

- [ ] **Step 4: Create `src/lib/school/resolveAdminContext.ts`**

```ts
// src/lib/school/resolveAdminContext.ts
// Server-component auth + scope resolver for the (school-admin) surface.
// requireRole redirects on unauth/wrong-role/trial-expiry. Resolves the EFFECTIVE
// schoolId: school-scoped admins get their own school; platform_admin gets ?school=
// (or null → the page renders a "pick a school" state). Never lets a non-platform
// role override its school.
import { requireRole } from '@/lib/auth/requireRole';
import { SCHOOL_ADMIN_ROLES } from '@/lib/auth/roles';
import { adminCapabilities, type AdminCapabilities } from '@/lib/auth/adminCapabilities';

export interface AdminContext {
  userId: string;
  role: string;
  fullName: string | null;
  schoolId: string | null;
  isPlatform: boolean;
  caps: AdminCapabilities;
}

export async function resolveAdminContext(searchParams?: { school?: string }): Promise<AdminContext> {
  const ctx = await requireRole(SCHOOL_ADMIN_ROLES);
  const isPlatform = ctx.role === 'platform_admin';
  const schoolId = isPlatform ? (searchParams?.school ?? ctx.schoolId ?? null) : ctx.schoolId;
  return { userId: ctx.userId, role: ctx.role, fullName: ctx.fullName, schoolId, isPlatform, caps: adminCapabilities(ctx.role) };
}
```

- [ ] **Step 5: Run tests to verify they pass + tsc**

Run: `npx vitest run src/lib/auth/__tests__/adminCapabilities.test.ts && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/adminCapabilities.ts src/lib/school/resolveAdminContext.ts src/lib/auth/__tests__/adminCapabilities.test.ts
git commit -m "feat(school-admin): adminCapabilities + resolveAdminContext (auth scaffolding)"
```

---

### Task 2: The admin shell (mirror the teacher shell)

**Files:**
- Create: `src/app/(school-admin)/_components/adminNavConfig.ts`
- Create: `src/app/(school-admin)/_components/AdminSidebar.tsx`
- Create: `src/app/(school-admin)/_components/AdminTopbar.tsx`
- Create: `src/app/(school-admin)/_components/AdminShell.tsx`
- Test: `src/app/(school-admin)/_components/__tests__/adminNavConfig.test.ts`

**Interfaces:**
- Consumes: `AdminCapabilities` (Task 1); the existing `core/icons`; reuses the teacher `matchActive` pattern.
- Produces: `AdminShell({ userName, avatarUrl, roleLabel, canSeeStudentAttention, children })`; `adminNavEntries(canSeeStudentAttention): NavEntry[]`; `pageTitleFor(pathname)`.

**Approach:** mirror `src/app/(teacher)/_components/{TeacherShell,TeacherSidebar,TeacherTopbar,SidebarNav,navConfig.ts}` (READ them) with these differences: (a) NO `ClassSwitcherPill` (admin isn't class-scoped); (b) the nav is role-aware — the Student-Attention entry is filtered out unless `canSeeStudentAttention`; (c) footer role label is the passed `roleLabel`; (d) `data-role="admin"`; (e) reuse existing icons (no new SVGs).

- [ ] **Step 1: Write the failing test** — `adminNavConfig.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { adminNavEntries, pageTitleFor } from '@/app/(school-admin)/_components/adminNavConfig';

function hrefs(entries: ReturnType<typeof adminNavEntries>): string[] {
  return entries.flatMap((e) => ('items' in e ? e.items.map((i) => i.href) : [e.href]));
}

describe('adminNavEntries', () => {
  it('omits Student Attention for IT (no pedagogy capability)', () => {
    expect(hrefs(adminNavEntries(false))).not.toContain('/admin/students');
    expect(hrefs(adminNavEntries(false))).toEqual(expect.arrayContaining(['/admin/overview', '/admin/teachers', '/admin/classes', '/admin/analytics', '/admin/reports']));
  });
  it('includes Student Attention for the academic head', () => {
    expect(hrefs(adminNavEntries(true))).toContain('/admin/students');
  });
});

describe('pageTitleFor', () => {
  it('maps known admin routes', () => {
    expect(pageTitleFor('/admin/overview')).toBe('Overview');
    expect(pageTitleFor('/admin/classes')).toBe('Classes & Roster');
    expect(pageTitleFor('/admin/students')).toBe('Student Attention');
    expect(pageTitleFor('/something-else')).toBe('CORE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(school-admin)/_components/__tests__/adminNavConfig.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `adminNavConfig.ts`** (reuse the teacher `NavItem`/`NavGroup`/`matchActive` shapes)

```ts
// src/app/(school-admin)/_components/adminNavConfig.ts
// Single source of truth for the school-admin nav. Role-aware: the Student-Attention
// entry appears ONLY when the caller has the pedagogy capability (academic head /
// platform_admin). Reuses existing core icons.
export type AdminNavIconKey = 'overview' | 'teachers' | 'classes' | 'analytics' | 'reports' | 'students';

export interface AdminNavItem { label: string; href: string; icon: AdminNavIconKey; alsoActiveWhen?: string[] }
export interface AdminNavGroup { groupLabel: string; items: AdminNavItem[] }
export type AdminNavEntry = AdminNavItem | AdminNavGroup;
export function isGroup(e: AdminNavEntry): e is AdminNavGroup { return 'items' in e; }

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
    { groupLabel: 'SCHOOL', items: [
      { label: 'Teachers', href: '/admin/teachers', icon: 'teachers' },
      { label: 'Classes & Roster', href: '/admin/classes', icon: 'classes', alsoActiveWhen: ['/admin/classes'] },
    ]},
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
```

- [ ] **Step 4: Create `AdminSidebar.tsx`** — mirror `TeacherSidebar.tsx` (logo plate + footer user/sign-out, same `sidebar-*` tokens), but REMOVE the `ClassSwitcherPill` and the SPARK sticker block, render the nav from `adminNavEntries(canSeeStudentAttention)`, and show the passed `roleLabel`. Props: `{ userName: string|null; avatarUrl?: string|null; roleLabel: string; canSeeStudentAttention: boolean }`. Render the nav inline (a small `'use client'` component using `usePathname` + `matchActive`, mapping `AdminNavIconKey` → existing icons: overview→`IconInsights`, teachers→`IconRoster`, classes→`IconRoster`, analytics→`IconInsights`, reports→`IconLessons`, students→`IconHighFive`). Active link styling identical to the teacher `NavLink` (`bg-sidebar-active text-sidebar-active-fg shadow-sticker`). Footer label uses `roleLabel` instead of "Teacher".

- [ ] **Step 5: Create `AdminTopbar.tsx`** — mirror `TeacherTopbar.tsx` exactly (menu button, `pageTitleFor` from `adminNavConfig`, client-only greeting to avoid #418, avatar/initials). Reuse `initialsOf`/`greetingFor` by importing them from the teacher topbar (`import { initialsOf, greetingFor } from '@/app/(teacher)/_components/TeacherTopbar'`) — they're exported and role-agnostic.

- [ ] **Step 6: Create `AdminShell.tsx`** — mirror `TeacherShell.tsx`: `data-role="admin"`, persistent `lg` rail + mobile drawer (same structure), `AdminTopbar` + `main.pop-canvas`. Props add `roleLabel` + `canSeeStudentAttention`, passed to `AdminSidebar`. No `alertCount`.

- [ ] **Step 7: Run tests to verify they pass + tsc**

Run: `npx vitest run "src/app/(school-admin)/_components/__tests__/adminNavConfig.test.ts" && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(school-admin)/_components/" && git commit -m "feat(school-admin): pop-art admin shell (sidebar/topbar/nav, role-aware)"
```

---

### Task 3: Wire the layout + retire the placeholder

**Files:**
- Modify: `src/app/(school-admin)/layout.tsx`
- Modify: `src/app/(school-admin)/admin/dashboard/page.tsx` → redirect to `/admin/overview`
- Test: `src/app/(school-admin)/__tests__/layout.test.tsx` (jsdom — render with a mocked context)

**Interfaces:** Consumes `AdminShell` (Task 2), `requireRole`/`adminCapabilities` (Task 1).

- [ ] **Step 1: Rewrite `layout.tsx`** to resolve role + name + avatar + caps and render `AdminShell`:

```tsx
// Route-group layout for the customer-school admin surface.
import { AdminShell } from './_components/AdminShell';
import { requireRole } from '@/lib/auth/requireRole';
import { SCHOOL_ADMIN_ROLES } from '@/lib/auth/roles';
import { adminCapabilities } from '@/lib/auth/adminCapabilities';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

const ROLE_LABEL: Record<string, string> = {
  school_admin: 'School Admin',
  school_sysadmin: 'IT Admin',
  platform_admin: 'Platform Admin',
};

export default async function SchoolAdminLayout({ children }: { children: React.ReactNode }) {
  const { role, fullName, userId } = await requireRole(SCHOOL_ADMIN_ROLES);
  const admin = createAdminSupabaseClient();
  const { data: avatarRow } = await admin.from('users').select('avatar_url').eq('id', userId).maybeSingle();
  const caps = adminCapabilities(role);
  return (
    <AdminShell
      userName={fullName}
      avatarUrl={(avatarRow?.avatar_url ?? null) as string | null}
      roleLabel={ROLE_LABEL[role] ?? 'Administrator'}
      canSeeStudentAttention={caps.canSeeStudentAttention}
    >
      {children}
    </AdminShell>
  );
}
```

- [ ] **Step 2: Replace the dashboard placeholder** (`admin/dashboard/page.tsx`) with a redirect (keeps any old bookmark working):

```tsx
import { redirect } from 'next/navigation';
export default function AdminDashboardRedirect() {
  redirect('/admin/overview');
}
```

- [ ] **Step 3: Component test** — render `AdminShell` directly (jsdom) with `canSeeStudentAttention={false}` and assert the "Student Attention" link is absent; with `true`, present. (The layout itself is a server component with auth — test the shell, not the layout's auth, which `requireRole` covers elsewhere.)

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { render, screen } from '@testing-library/react';
import { AdminShell } from '@/app/(school-admin)/_components/AdminShell';
// mock next/navigation usePathname → '/admin/overview'
it('hides Student Attention from IT', () => {
  render(<AdminShell userName="Sam" roleLabel="IT Admin" canSeeStudentAttention={false}>x</AdminShell>);
  expect(screen.queryByText('Student Attention')).toBeNull();
});
it('shows Student Attention to the academic head', () => {
  render(<AdminShell userName="Sam" roleLabel="School Admin" canSeeStudentAttention>x</AdminShell>);
  expect(screen.getByText('Student Attention')).toBeInTheDocument();
});
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run "src/app/(school-admin)/__tests__/layout.test.tsx" && npx tsc --noEmit`
Expected: PASS, tsc 0.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(school-admin)/layout.tsx" "src/app/(school-admin)/admin/dashboard/page.tsx" "src/app/(school-admin)/__tests__/" && git commit -m "feat(school-admin): wire AdminShell into the layout; retire placeholder → /admin/overview"
```

---

### Tasks 4–8: the operational pages (uniform pattern)

Every page below follows ONE pattern (shown fully in Task 4; Tasks 5–8 give their own loader + presentational content but reuse this page scaffold):

```tsx
// src/app/(school-admin)/admin/<name>/page.tsx
import { resolveAdminContext } from '@/lib/school/resolveAdminContext';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { load<X> } from '@/lib/school/load<X>';
import { PickASchool } from '../../_components/PickASchool'; // shared empty-state (Task 4 creates it)

export default async function Page({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  const sp = await searchParams;
  const { schoolId } = await resolveAdminContext(sp);
  if (!schoolId) return <PickASchool />;
  const admin = createAdminSupabaseClient();
  const data = await load<X>(admin, schoolId);
  return /* presentational components built from core/* kit */;
}
```

`PickASchool` (Task 4 creates `(school-admin)/_components/PickASchool.tsx`): a calm `EmptyState`-style card "Choose a school to view" linking to `/schools` (platform-admin only reaches this).

---

### Task 4: Overview page + loader + PickASchool

**Files:**
- Create: `src/lib/school/loadSchoolOverview.ts`
- Create: `src/app/(school-admin)/_components/PickASchool.tsx`
- Create: `src/app/(school-admin)/admin/overview/page.tsx` + `_components/OverviewCards.tsx`
- Test: `src/lib/school/__tests__/loadSchoolOverview.test.ts`

**Interfaces:** `loadSchoolOverview(admin, schoolId): Promise<SchoolOverview>` where
```ts
export interface SchoolOverview {
  schoolName: string;
  license: { tier: string | null; status: string | null; studentLimit: number | null; trialEndsAt: string | null };
  seatsUsed: number;
  counts: { students: number; teachers: number; classes: number };
  thisWeek: { assignmentsSubmitted: number; quizzesPublished: number; openAlerts: number; highFives: number };
}
```

- [ ] **Step 1: Write the failing test** — mock the admin client's per-table queries; assert `loadSchoolOverview` returns the aggregated shape (seatsUsed = distinct active enrolled students; counts by role; thisWeek counts windowed to 7 days). Cover an empty school → all zeros + null license.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `loadSchoolOverview.ts`** — queries (all `.eq('school_id', schoolId)` or class→school):
  - school name: `schools.select('name').eq('id', schoolId)`.
  - license: `school_licenses.select('tier,status,student_limit,trial_ends_at').eq('school_id', schoolId).maybeSingle()`.
  - counts: `users` count by `(school_id, role, is_active=true)` for student/teacher; `classes` count by `(school_id, is_active=true)`.
  - seatsUsed: distinct active students enrolled — `enrollments` join `classes` (school) + active; or reuse the student count (active students in school) as the seat metric (matches the `enforce_enrollment_limit` definition). Use the school's active-student count.
  - thisWeek: `homework_attempts` submitted in 7d (join assignments→classes→school), `quizzes` published in 7d (join classes→school), `alerts` open count (`school_id`, status='open'), `high_fives` count (`school_id`, created_at≥7d). Use the admin client (RLS bypass) — guard already scoped the caller.
  Return the shape; default to 0/null on empty.

- [ ] **Step 4: Create `PickASchool.tsx`** (calm EmptyState card → `/schools`).

- [ ] **Step 5: Create `OverviewCards.tsx` + `overview/page.tsx`** — render cards from the `core/*` kit (`Card`/`SectionLabel`): License & seats ("142 of 300 seats", status, trial/renewal date, gentle warn band near cap), At-a-glance counts, This-week activity + light health (counts only). ≤ a few numbers per card. Token-only. (No per-student data.)

- [ ] **Step 6: Run tests + tsc; Step 7: Commit** (`feat(school-admin): Overview page (license/seats, counts, activity)`).

---

### Task 5: Teachers page + loader

**Files:** `src/lib/school/loadSchoolTeachers.ts`, `admin/teachers/page.tsx` + `_components/TeachersList.tsx`, test.

**Interfaces:** `loadSchoolTeachers(admin, schoolId): Promise<SchoolTeacher[]>`,
`SchoolTeacher = { id; name; email; lastActive: string|null; classes: { id; name; subject: string|null; grade: string|null; enrollment: number }[]; studentCount: number }`.

- [ ] **Steps:** TDD the loader (teachers via `users` role='teacher' school-scoped; their classes via `classes.teacher_id`; enrollment counts via `enrollments` active; `studentCount` = distinct students across their classes; `lastActive` = `users.last_active_at`). Page renders an expandable list (name/email/#classes/#students/last-active → expand to class rows). **No risk/effectiveness.** tsc + commit.

---

### Task 6: Classes & Roster page + loaders

**Files:** `src/lib/school/{loadSchoolClasses,loadClassRoster}.ts`, `admin/classes/page.tsx` + `_components/ClassesList.tsx`, tests.

**Interfaces:** `loadSchoolClasses(admin, schoolId): Promise<SchoolClass[]>` (`{ id; name; subject; grade; teacherName: string|null; enrollment: number; googleSynced: boolean }`); `loadClassRoster(admin, classId, schoolId): Promise<{ students: { id; name; email; active: boolean; source: string|null }[] } | null>` (returns null if the class isn't in this school — IDOR guard).

- [ ] **Steps:** TDD both loaders (classes school-scoped + teacher name join + active-enrollment count + `googleSynced` = any enrollment `source='google'` or `classes.google_course_id` present; roster scoped + verifies `class.school_id === schoolId`). Page: class list → expand → roster; a link to `/import` (roster importer). **No per-student diagnostics.** tsc + commit.

---

### Task 7: Analytics page + loader (aggregate only)

**Files:** `src/lib/school/loadSchoolAnalytics.ts`, `admin/analytics/page.tsx` + `_components/AnalyticsView.tsx`, test.

**Interfaces:** `loadSchoolAnalytics(admin, schoolId): Promise<SchoolAnalytics>` —
`{ weeks: { weekStart: string; assignmentsSubmitted: number; quizzesPublished: number }[]; classes: { name: string; completionPct: number; activity: number }[]; adoption: { teachersActive: number; studentsActive: number } }`. Reuse `isoWeekMonday` (`src/lib/utils/isoWeekMonday`) for week bucketing. **AGGREGATE ONLY — no per-student rows, no risk.**

- [ ] **Steps:** TDD the loader (windowed weekly activity counts; per-class completion = graded/submitted ratio over the school's classes; adoption = distinct teachers/students active in the last 7d via `last_active_at` or activity). Page: a calm trend (reuse `GradeTrendSparkline` or a token line) + a class-comparison list + the two adoption numbers. tsc + commit.

---

### Task 8: Reports page + loader + CSV export

**Files:** `src/lib/school/loadSchoolReport.ts`, `src/app/api/admin/school-report/route.ts` (CSV), `admin/reports/page.tsx` + `_components/ReportView.tsx`, tests.

**Interfaces:** `loadSchoolReport(admin, schoolId): Promise<SchoolReport>` (aggregate summary: totals + per-class rollup rows, operational only). The CSV route is `GET /api/admin/school-report?school=…` → `guardSchoolAdmin()` (API guard; non-platform pinned to own school — IGNORE a `?school=` for non-platform), builds CSV from the same loader, returns `text/csv`.

- [ ] **Steps:** TDD the loader + the route (auth: 401/403; non-platform school-pinned; CSV content-type + a header row). Page: summary cards + per-class rollup table + a "Download CSV" link to the route. **No per-student signals.** tsc + commit.

---

### Task 9: Student Attention page + loader + URL-guard (academic head only)

**Files:** `src/lib/school/loadStudentAttention.ts`, `admin/students/page.tsx` + `_components/AttentionRollup.tsx`, tests.

**Interfaces:** `loadStudentAttention(admin, schoolId): Promise<AttentionRollup>` —
`{ grades: { grade: string; classes: { classId: string; className: string; needsLook: { studentId: string; name: string }[] }[] }[] }`. Source: the latest `student_model_snapshots` per student in the school whose `mastery_band` is the lowest band (reteach) — i.e. "needs a look" — grouped by class+grade. **Band-level membership only; NEVER select/return a raw `risk_score`/`divergence` number.** Reuse the band→soft-label helper for any label.

- [ ] **Step 1: Write the failing tests** — (a) loader returns the grade→class→students rollup and the returned objects contain NO numeric risk field (assert no `risk`/`divergence` keys, only ids+names+band membership); (b) **the page redirects `school_sysadmin`** — a page test that mocks `resolveAdminContext` to return `caps.canSeeStudentAttention=false` asserts `redirect('/admin/overview')` is called; with `true`, it renders.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement the loader** — `student_model_snapshots` latest-per-student in school, band='reteach' (or the spec's "needs a look" rule), join `users` (name, grade) + the student's class via `enrollments`→`classes`. Return ONLY ids/names/grade/class — no numbers.

- [ ] **Step 4: Implement the page with the URL re-guard:**

```tsx
export default async function StudentAttentionPage({ searchParams }: { searchParams: Promise<{ school?: string }> }) {
  const sp = await searchParams;
  const ctx = await resolveAdminContext(sp);
  if (!ctx.caps.canSeeStudentAttention) redirect('/admin/overview'); // URL-guard: IT can't reach pedagogy
  if (!ctx.schoolId) return <PickASchool />;
  const admin = createAdminSupabaseClient();
  const data = await loadStudentAttention(admin, ctx.schoolId);
  return /* AttentionRollup: grade → class → "N students to check", each row links to /students/<id> */;
}
```

- [ ] **Step 5: `AttentionRollup.tsx`** — grade/class rollup ("Algebra I — 3 students to check"), each student row a `Link` to the EXISTING teacher view `/students/<studentId>`. Band-level/soft copy only; quiet-when-empty. NO raw risk numbers.

- [ ] **Step 6: Run tests + tsc; Step 7: Commit** (`feat(school-admin): Student Attention rollup (academic-head-gated, drills into teacher views)`).

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` → 0
- [ ] `npm test` → full suite green
- [ ] `npm run build` → 0 (a11y + tokens)
- [ ] Manual: a `school_sysadmin` sees no Student-Attention link AND `/admin/students` redirects to overview; a `school_admin` sees the link + the rollup drilling into `/students/<id>`; all pages scope to the caller's school; operational pages show no per-student risk.
- [ ] Append student-visible/admin-visible copy to `STRINGS-FOR-BARB.md §School Admin`.

## Spec coverage self-check
Shell (real, role-aware) → Task 2/3. Role split (IT operational-only; academic head +pedagogy; nav + URL-guard) → Tasks 1/2/9. Operational pages (Overview/Teachers/Classes/Analytics/Reports) → Tasks 4–8. Pedagogy = restrained band-level rollup drilling into existing teacher views → Task 9. No per-student risk on operational surfaces; band-level only on pedagogy → Tasks 4–9 loaders. platform_admin null-schoolId → PickASchool (Task 4) + resolveAdminContext (Task 1). No migration → none. Scoping by schoolId → every loader.
