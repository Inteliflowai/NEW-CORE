# P6 — V2 (NEW-CORE) Grounding: Student auth / session + login + layout patterns

READ-ONLY grounding for SPARK Phase 2, sub-project B (V2 student assignment app + SPARK LAUNCH JWT handoff).
Repo: `C:/users/inteliflow/NEW-CORE` · branch `main`. All facts verbatim with `file:line`. Nothing here is a proposal.

---

## 1. Student route group layout + `requireRole(['student'])`

### `src/app/(student)/layout.tsx` (full file, 33 lines)
```tsx
// Route-group layout for the student role.
// Sets data-role="student" + data-intensity="loud" via RoleLayout.
// The root layout (src/app/layout.tsx) owns <html>/<body> — this nests inside it.

import { RoleLayout } from '@/components/core/RoleLayout';
import { requireRole } from '@/lib/auth/requireRole';

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(['student']);
  const nav = (
    <>
      <a href="/student/dashboard" ...>Dashboard</a>
      <a href="/student/assignments" ...>Assignments</a>
      <a href="/student/growth" ...>Growth</a>
    </>
  );
  return (
    <RoleLayout role="student" nav={nav}>
      {children}
    </RoleLayout>
  );
}
```
- Note: the nav links to `/student/assignments` and `/student/growth` but **those routes do NOT exist** — only `src/app/(student)/student/dashboard/page.tsx` exists (Glob of `src/app/(student)/student/**` returns only the dashboard). The links are orphan targets today.
- The layout calls `requireRole(['student'])` and **discards its return value** (`await requireRole(...)` — no binding). Child pages do NOT receive the AuthedContext via props; they must re-resolve the user themselves (see §3).

### `src/lib/auth/requireRole.ts` (full file, 38 lines)
```ts
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { homeForRole } from '@/lib/auth/roleHome';
import type { Role } from '@/lib/auth/roles';

export interface AuthedContext {
  userId: string;
  role: Role;
  schoolId: string | null;
  fullName: string | null;
}

export async function requireRole(allowed: readonly Role[]): Promise<AuthedContext> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?expired=true');

  const { data: profile } = await supabase
    .from('users').select('role, school_id, full_name').eq('id', user.id).single();
  const role = (profile?.role ?? null) as Role | null;
  if (!role) redirect('/login');

  const schoolId = (profile?.school_id ?? null) as string | null;
  if (schoolId) {
    const { data: school } = await supabase
      .from('schools').select('trial_status').eq('id', schoolId).single();
    if (school?.trial_status === 'expired') redirect('/trial-expired');
  }

  if (!allowed.includes(role)) redirect(homeForRole(role));

  return { userId: user.id, role, schoolId, fullName: (profile?.full_name ?? null) as string | null };
}
```
**`AuthedContext` (requireRole.ts:6-11)** is exactly: `userId: string`, `role: Role`, `schoolId: string | null`, `fullName: string | null`.

Redirect chain (verbatim):
- no `user` → `redirect('/login?expired=true')` (line 21)
- profile has no `role` → `redirect('/login')` (line 26)
- `schoolId` set AND `schools.trial_status === 'expired'` → `redirect('/trial-expired')` (line 32)
- `role` not in `allowed` → `redirect(homeForRole(role))` (line 35)
- success → returns `{ userId, role, schoolId, fullName }` (line 37)

`userId` = `auth.users.id` (the Supabase auth UUID). Because `public.users.id` is `PRIMARY KEY REFERENCES auth.users(id)` (0001:41), **`user.id` === `public.users.id`** — they are the same UUID. `schoolId` = `public.users.school_id` (`uuid` nullable, 0001:42).

### `Role` type — `src/lib/auth/roles.ts:4-13`
```ts
export const ROLES = ['teacher','student','parent','school_admin','school_sysadmin','platform_admin'] as const;
export type Role = (typeof ROLES)[number];
export const SCHOOL_ADMIN_ROLES = ['school_admin','school_sysadmin','platform_admin'] as const;
export const STAFF_ROLES = ['teacher','school_admin','school_sysadmin','platform_admin'] as const;
```
`'student'` is a valid `Role`. There is **no** `STUDENT_ROLES` constant; the only student gate is `requireRole(['student'])`.

---

## 2. Login flow + `homeForRole` for student

### `src/app/login/page.tsx` (client component, `'use client'`)
Single `/login` page for all roles (Trial/Pilot/Clients). Three modes: `'signin' | 'magic' | 'forgot'` (line 9). Uses `createBrowserSupabaseClient()` (line 5, 21).

Password sign-in path (lines 42-48):
```ts
if (mode === 'signin') {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { setError(error.message); return; }
  const { data: profile } = await supabase
    .from('users').select('role').eq('id', data.user!.id).single();
  router.push(homeForRole(profile?.role ?? null));
  router.refresh();
}
```
A **student signs in with email + password here** → fetches their `users.role` → `router.push(homeForRole('student'))` → lands on `/student/dashboard`. Magic link (line 50) and forgot-password (line 57) modes redirect through `/auth/callback`.

### `src/lib/auth/roleHome.ts` (full, 22 lines)
```ts
export const ROLE_HOME: Record<Role, string> = {
  teacher: '/today',
  student: '/student/dashboard',
  parent: '/parent/dashboard',
  school_admin: '/admin/dashboard',
  school_sysadmin: '/admin/dashboard',
  platform_admin: '/provision',
};
export function homeForRole(role: string | null | undefined): string {
  if (role && role in ROLE_HOME) return ROLE_HOME[role as Role];
  return '/login';
}
```
**Student home = `/student/dashboard`** (roleHome.ts:11). That route exists but is a placeholder (`src/app/(student)/student/dashboard/page.tsx`):
```tsx
export default function StudentHome() {
  return (
    <div className="p-8">
      <div className="rounded-lg bg-surface p-8 shadow">
        <h1 className="font-display text-fg text-xl">Your CORE space is being set up</h1>
        <p className="mt-2 text-fg">Check back soon — your learning view is on the way.</p>
      </div>
    </div>
  );
}
```

### `src/app/auth/callback/route.ts` (full, 42 lines)
Handles `token_hash`+`type` (recovery/magic/confirm via `verifyOtp`) and `code` (PKCE via `exchangeCodeForSession`). Does **not** role-fetch — it redirects to `next` (default `/`), and the proxy resolves `/` → role home. `isSafeRedirectPath` blocks off-origin/`//`/scheme/backslash `next` values (lines 6-8). On error → `/login?error=reset_expired` or `/auth/auth-code-error`.

### `src/app/set-password/page.tsx` (client component)
Recovery/invite landing. Waits for a Supabase session (`getSession` + `onAuthStateChange` on `PASSWORD_RECOVERY`/`SIGNED_IN`, lines 30-42), calls `supabase.auth.updateUser({ password })` (line 55), then `router.push('/login')`. 3s fallback shows "reset link invalid/expired". This is the path a newly-provisioned student would use to set a password if invited via recovery/invite email.

---

## 3. How a student route gets `users.id` + `school_id` server-side (for the launch JWT)

The canonical server pattern is `createServerSupabaseClient()` → `auth.getUser()` → fetch `public.users` row by `user.id`.

### `src/lib/supabase/server.ts` (key parts)
```ts
export async function createServerSupabaseClient() {
  const cookieStore = await cookies(); // Next 16: cookies() is async
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  ...
  const client = createServerClient(url, key, { cookies: { getAll/setAll } });
  ...
  return client;
}
// Service-role (BYPASSES RLS):
export function createAdminSupabaseClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}
```

**To obtain `core_user_id` + `core_school_id` inside a student route handler / Server Component**, two existing patterns work verbatim:

(a) Call the layout guard's resolver shape directly (the established student-scope pattern):
```ts
const supabase = await createServerSupabaseClient();
const { data: { user } } = await supabase.auth.getUser();         // user.id = users.id (PK = auth.users.id)
const { data: profile } = await supabase
  .from('users').select('role, school_id').eq('id', user.id).single();
// core_user_id  = user.id          (== public.users.id)
// core_school_id = profile.school_id (public.users.school_id, may be null)
```
This is exactly what `requireRole` (requireRole.ts:19-28) and `resolveCaller` (guards.ts:18-25) do. `resolveCaller` returns `{ id, role, school_id }` but it is a **private (non-exported)** function inside `guards.ts` — there is no exported "get current user + school" helper.

(b) `requireRole(['student'])` already returns `{ userId, role, schoolId, fullName }` — but the **student layout discards it** (layout.tsx:13), so a child page that wants those values must call `requireRole(['student'])` again itself, or re-resolve via (a). There is no React context / props handoff of `AuthedContext` to child routes today.

DB facts (migration `0001_identity_roles.sql`):
- `public.users.id uuid PRIMARY KEY REFERENCES auth.users(id)` (0001:41) → JWT `sub` / `getUser().id` == `users.id`.
- `public.users.school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE` — **nullable** (no NOT NULL) (0001:42).
- `role text NOT NULL CHECK (role IN ('teacher','student','parent','school_admin','school_sysadmin','platform_admin'))` (0001:43).
- RLS: `users_self_read` allows `id = auth.uid() OR school_id = get_my_school_id() OR is_platform_admin()` (0001:108-109) — a student CAN read their own row with the anon/publishable server client (no admin client needed for self).

---

## 4. Student app-shell / nav

There is **no dedicated student app-shell** equivalent to the teacher pop-art shell. The student layout uses the shared, plain `RoleLayout` only.

### `src/components/core/RoleLayout.tsx` (key parts)
```tsx
export type Role = 'student' | 'teacher' | 'parent' | 'admin' | 'super-admin';
function intensityFor(role: Role): 'loud' | 'calm' {
  return role === 'student' ? 'loud' : 'calm';
}
export function RoleLayout({ role, nav, children }: RoleLayoutProps) {
  const intensity = intensityFor(role);
  return (
    <div data-role={role} data-intensity={intensity} className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)]">
      <header ...> ◆ CORE {nav && <nav aria-label="Role navigation">{nav}</nav>} </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```
- Student gets `data-role="student"` + `data-intensity="loud"` (RoleLayout.tsx:11-12, 31-35). This is a presentational shell only — a header with the ◆ CORE mark + the nav slot the layout passes in. No pop-art rail, no sidebar.
- (Per MEMORY: the teacher pop-art shell is HELD unmerged pending SPARK; on `main` even the teacher uses placeholder slots. The student has nothing more than RoleLayout.)
- Note RoleLayout's local `Role` type is a **different union** (`'admin' | 'super-admin'`) than `roles.ts`'s `Role` (`school_admin` etc.) — it's a presentational alias, not the auth Role.

---

## 5. SPARK-relevant: existing spark table (context only)

`supabase/migrations/0012_spark.sql` exists and references `public.users`/`public.schools` (e.g. `spark_completions.school_id uuid REFERENCES public.schools(id)`, 0012:26; RLS uses `get_my_school_id()`, 0012:60). Confirms V2 already has a `spark_completions` table keyed by `school_id`. (Full schema is in the SPARK-table grounding doc, not here.)

---

## FLAGS / GAPS / RISKS (assumptions the design must verify)

1. **Students CAN log in to V2 today.** The universal `/login` page (`signInWithPassword` + magic link + forgot) plus `/auth/callback` + `/set-password` all exist and route a student to `/student/dashboard` via `homeForRole('student')`. The session/cookie chain is real (proxy `getUser`, server `createServerSupabaseClient`). So student auth is NOT a blocker.

2. **`core_user_id` + `core_school_id` are both obtainable in a student route**, but there is **no exported helper** that returns them. The launch route must either re-call `requireRole(['student'])` (returns `{ userId, schoolId }`) or inline the `getUser()` + `users` select (guards.ts `resolveCaller` is the pattern but is private/non-exported). DESIGN GAP: no `getCurrentUser()`/`requireStudent()→ctx` utility exists; either reuse `requireRole`'s return (and stop discarding it) or add one.

3. **`users.school_id` is NULLABLE** (0001:42; AuthedContext `schoolId: string | null`). A launch JWT that requires a non-null `core_school_id` must handle the null case — a student with no school would fail. Verify all SPARK students are provisioned with a `school_id`.

4. **`core_user_id` == `auth.users.id` == `public.users.id`** (PK = FK to auth.users, 0001:41). The JWT `sub` already equals `users.id` — no extra lookup needed if the JWT only needs `users.id`. A lookup IS needed for `school_id`.

5. **Student app is essentially empty.** Only `/student/dashboard` exists (a placeholder "being set up" page). The layout's nav links to `/student/assignments` + `/student/growth` are **orphan routes (404)**. There is NO assignment list, NO challenge launcher, NO student API routes today. The entire student assignment app (sub-project B) is greenfield.

6. **No student app-shell.** Student uses the shared plain `RoleLayout` (header + ◆ CORE + nav slot), `data-intensity="loud"`. No pop-art shell (that's teacher-only and unmerged). Any "loud" student UI must be built.

7. **Layout discards the auth context.** `(student)/layout.tsx:13` does `await requireRole(['student'])` without binding — child pages don't inherit `userId`/`schoolId`. Each student page/route re-resolves auth independently.

8. **No existing JWT-minting / cross-app handoff code** was found in the auth surface (no `jsonwebtoken`/`jose` usage in login/callback/guards). The launch JWT signer is greenfield in V2.
