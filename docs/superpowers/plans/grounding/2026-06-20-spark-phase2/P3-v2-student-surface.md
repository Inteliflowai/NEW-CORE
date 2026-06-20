# P3 — V2 (NEW-CORE) Student Surface — Verbatim Grounding (SPARK Phase 2-B)

READ-ONLY grounding. Facts only, quoted with `file:line`. No proposals.
Repo: `C:/users/inteliflow/NEW-CORE` (Next.js 16 App Router, TS, Supabase, branch `main`).

---

## ★★★ HEADLINE FLAG — the core Phase-2-B gap ★★★

**A V2 student ASSIGNMENT list / detail / attempt UI does NOT exist at all.** The entire `(student)`
route group is a single cold-start placeholder page. There is no `/student/assignments` route, no
`/student/growth` route, no challenge launcher, no attempt-taking UI, and no JWT/launch-token machinery
anywhere in the repo.

What EXISTS under `(student)`:
- `src/app/(student)/layout.tsx` — role gate + nav shell (nav links to routes that do not exist)
- `src/app/(student)/student/dashboard/page.tsx` — a static placeholder card ("Your CORE space is being set up")
- `src/app/(student)/__tests__/layout.guard.test.tsx` — one guard test

That is the COMPLETE inventory of the student surface. (Glob `src/app/(student)/**` returns exactly those three files; `src/app/(student)/student/**/page.tsx` returns ONLY `dashboard/page.tsx`.)

---

## 1. `(student)` route group — full file inventory

Glob `src/app/(student)/**`:
```
src/app/(student)/layout.tsx
src/app/(student)/student/dashboard/page.tsx
src/app/(student)/__tests__/layout.guard.test.tsx
```

### 1a. `src/app/(student)/layout.tsx` (FULL, 34 lines)

```tsx
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
      <a href="/student/dashboard" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Dashboard
      </a>
      <a href="/student/assignments" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Assignments
      </a>
      <a href="/student/growth" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">
        Growth
      </a>
    </>
  );

  return (
    <RoleLayout role="student" nav={nav}>
      {children}
    </RoleLayout>
  );
}
```

NOTE: this layout uses raw `text-[var(--fg)]`/`hover:text-[var(--brand)]` arbitrary-token classes — a
deviation from the CLAUDE.md "Tier-2 token classes only, no arbitrary `[var(--..)]`" discipline.

### 1b. `src/app/(student)/student/dashboard/page.tsx` (FULL, 10 lines) — PLACEHOLDER

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
This is a static, server-rendered placeholder. It fetches nothing; no client component; no data.

---

## 2. `/student/assignments` and `/student/growth` — DEAD nav links

The nav in `layout.tsx:19` links to `/student/assignments` and `layout.tsx:22` links to
`/student/growth`. **Neither route exists.** Only `/student/dashboard` resolves to a page
(`student/dashboard/page.tsx`). Glob of `src/app/(student)/student/**/page.tsx` returns ONLY
`dashboard/page.tsx`. Clicking "Assignments" or "Growth" yields a 404.

(There IS an `/api/student/growth` API route — see §4 — but no PAGE consumes it.)

There is no separate "student nav config" module (unlike teacher's `src/app/(teacher)/_components/navConfig.ts`).
The student nav is inline JSX in the layout, quoted above.

---

## 3. Student role gate + session/auth

The student group is gated by `await requireRole(['student'])` at `layout.tsx:13`.

### `src/lib/auth/requireRole.ts` (FULL, 38 lines)

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

- Session = Supabase cookie session resolved via `auth.getUser()`. The DB `role` for a student is the
  string `'student'` (read from `public.users.role`).
- Role-home map `src/lib/auth/roleHome.ts:10-16`: `student: '/student/dashboard'`. So a freshly-logged-in
  student lands on the placeholder dashboard.
- Trial-expiry gate: if the student's school `trial_status === 'expired'`, redirect `/trial-expired`.

### Proxy-level gate — `src/proxy.ts` (FULL, 68 lines)

```ts
const PUBLIC_PREFIXES = ['/login', '/set-password', '/logout', '/auth', '/trial-expired'];
...
  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  ...
  if (user && (pathname === '/' || pathname === '/login')) {
    const { data: profile } = await supabase
      .from('users').select('role').eq('id', user.id).single();
    const home = homeForRole(profile?.role ?? null);
    if (home !== pathname) return redirectTo(home);
  }
  if (!user && pathname === '/') return redirectTo('/login');
  if (!user && !isPublic(pathname)) return redirectTo('/login', '?expired=true');
```
Matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and image extensions (proxy.ts:63-67).
This is a Next.js 16 `proxy.ts` (not `middleware.ts`).

---

## 4. Student-facing API routes — `src/app/api/student/**`

Only ONE student API route exists:
```
src/app/api/student/growth/route.ts   (+ __tests__/route.test.ts)
```

### `GET /api/student/growth` — shape (verbatim from route.ts)

Auth: `supabase.auth.getUser()` → 401 if none (route.ts:22-25). Then `createAdminSupabaseClient()` (route.ts:27).
Reads `student_model_snapshots` ONLY, filtered `.eq('student_id', user.id)`, `.order('snapshot_date' desc).limit(12)` (route.ts:32-39).

Explicitly NEVER reads `skill_learning_state` or `misconception_observations` (route.ts:30-31; test enforces with a throwing mock).

Cold-start response (no snapshots) — route.ts:48-53:
```json
{ "cold_start": true,
  "message": "Just getting started — check back after your first few quizzes to see your growth.",
  "snapshots": [],
  "next_action": null }
```

Populated response — route.ts:96-100, each snapshot mapped (route.ts:69-79):
```
{ cold_start: false,
  snapshots: [{ snapshot_date, avg_score, mastery (soft label via masteryDisplayLabel — NEVER raw band),
                consistency_label, dominant_effort_pattern, strength_topics[], struggle_topics[], improvement_4w }],
  next_action: string }   // "Keep practicing: <topic>" or "You're on track — keep going." (route.ts:88-94)
```
Four-audience discipline is enforced here: `mastery_band` enum is mapped to a soft word and never emitted; `next_action` never uses diagnostic words (test route.test.ts:349-373).

There are NO student API routes for: assignments list, assignment detail, starting/launching a SPARK challenge, or recording an attempt from the student side.

---

## 5. Student components in `src/components`

Glob `src/components/**/*tudent*` → **No files found.** There is no student-specific component
(no "RoleLayout student variant" as a separate file). The only shared shell is:

### `src/components/core/RoleLayout.tsx` (FULL, 58 lines) — used by ALL role groups

```tsx
export type Role = 'student' | 'teacher' | 'parent' | 'admin' | 'super-admin';

function intensityFor(role: Role): 'loud' | 'calm' {
  return role === 'student' ? 'loud' : 'calm';
}
...
export function RoleLayout({ role, nav, children }: RoleLayoutProps) {
  const intensity = intensityFor(role);
  return (
    <div data-role={role} data-intensity={intensity}
         className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)]">
      <header ...>
        <span aria-label="CORE" ...>◆ CORE</span>
        {nav && <nav className="flex-1" aria-label="Role navigation">{nav}</nav>}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```
Student variant = `data-intensity="loud"` (vs `calm` for all staff). This is a presentational
data-attribute only; there is no distinct student layout/component, no SPARK challenge card, no
attempt UI. NOTE: this is the generic pre-Pop-Art shell — the locked "Pop-Art" teacher app-shell
(MEMORY: `v2-teacher-app-shell-popart`) is a separate teacher-only shell and does NOT wrap students.

---

## 6. ADJACENT existing SPARK + attempt machinery (relevant to Phase-2-B, but server/teacher-side)

These EXIST and the student app would plug into them — but none is student-facing UI.

### Assignments data model — `supabase/migrations/0004_assignments_homework.sql` + `0012_spark.sql`
- `public.assignments` (0004:4-22): `id, quiz_attempt_id, student_id, class_id, lesson_id, mastery_band, assignment_mode, learning_style, content jsonb NOT NULL, status default 'draft', ..., due_at, created_at`.
- `public.homework_attempts` (0004:24-40): the attempt store (legacy "homework" name; UI term is "Assignments").
- SPARK binding columns added to `assignments` (0012:8-12): `spark_assignment_id text, spark_attempt_id text, spark_experiment_id text, spark_status text DEFAULT 'none'`. Check constraint (0012:16-20): `spark_status IN ('none','notified','created','in_progress','completed','notify_failed')`.
- `public.spark_completions` (0012:24-42): one row per `(assignment_id, student_id)` UNIQUE; holds `score, effort_label, rubric_dimensions jsonb, content_quality, transfer_score, revision_count, teli_hint_count, signal_summary, completed_at`. RLS: service_role full; staff school-scoped SELECT; **NO student/parent read** (0012:55-62).
- `assignments` RLS (0004:46-50): students CAN read their own (`student_id = auth.uid()`).

### SPARK contract libs (`src/lib/spark/`)
- `config.ts:5-6`: `SPARK_API_URL` (default `https://spark.inteliflowai.com`), `CORE_SPARK_API_SECRET` (env, default `''`).
- `notifyAssignmentCreated.ts`: CORE→SPARK create-notify. `POST {SPARK_API_URL}/api/integration/webhooks/core`, `Authorization: Bearer {CORE_SPARK_API_SECRET}`, `X-Idempotency-Key {coreHomeworkId}_{studentId}`. Returns `{ success, sparkAssignmentId, sparkAttemptId?, syntheticExperimentId?, ... }`. **This is the OUTBOUND assignment-create path, not a student-launch path.**
- `auth.ts`: `bearerMatches(authHeader, secret)` constant-time check (inbound webhook auth).
- `contract.ts`: pure mappers — `bandToSparkBand`, `gradeToBand` (rejects K-2 → null), `computeTransferScore`, `transferWord`.
- `sparkLink.ts`: `getSparkLink(admin, schoolId)` / `provisionSparkLink(...)` over `platform_links` (product='spark', enabled). Phase-1 SPARK gate = presence of an ENABLED row.
- `loadChallenges.ts`: TEACHER screen loader (joins `assignments` + `spark_completions` by `class_id`). `ChallengeRow.status: 'assigned' | 'in_progress' | 'completed'`.

### Inbound completion + attempt routes (`src/app/api/`)
- `POST /api/attempts/spark-attempt-complete/route.ts`: SPARK→CORE completion ingestion. Bearer-gated (NOT user auth). Idempotent via `webhook_idempotency_keys`. Upserts `spark_completions`, audits `platform_events`, feeds `recomputeSkillStatesForStudent`. **This is the SPARK→CORE callback, not a student-initiated route.**
- `POST /api/attempts/[attemptId]/submit/route.ts`: the CORE-native QUIZ attempt grader (user-auth, caller must own the attempt via `.eq('student_id', user.id)`). Grades MCQ/numeric (pos 1-3) + OEQ (pos 4-5). This is the CORE quiz pipeline — **separate from SPARK challenges; also has no student-facing UI in the (student) group.**
- `POST /api/attempts/[attemptId]/adapt/route.ts` exists (not read in full).
- `POST /api/teacher/assignments/generate/route.ts` exists (teacher-side generation).

---

## ★ DISCREPANCY / RISK / GAP FLAGS

1. **GAP (core P2-B):** No student assignment list / detail / attempt UI exists. `(student)` is one placeholder page. The entire student-facing Spark-Challenge flow (list challenges → open → launch into SPARK) must be built from scratch.
2. **GAP (auth handoff):** NO JWT / launch-token machinery anywhere (grep for `jwt|jsonwebtoken|SignJWT|jose|launch_token|launchToken|signLaunch` → no files). A "SPARK LAUNCH (JWT) handoff" assumed by the design does NOT exist; only a Bearer-secret server-to-server contract (`CORE_SPARK_API_SECRET`) and the create-notify webhook exist. No `launch_url`/`spark_url` column in any migration.
3. **DEAD LINKS:** Nav links `/student/assignments` and `/student/growth` (layout.tsx:19,22) point to routes that do not exist → 404. Only `/student/dashboard` resolves.
4. **NO student-facing assignments API:** Students can read `assignments` directly via RLS (`student_id = auth.uid()`), but there is no `/api/student/assignments` route. `spark_completions` is explicitly RLS-DENIED to students (0012:55-62) — a student app cannot read its own completion/score via that table.
5. **DISCIPLINE deviation:** `(student)/layout.tsx` uses arbitrary `text-[var(--fg)]` / `hover:text-[var(--brand)]` classes, violating the "Tier-2 token classes only, no arbitrary `[var(--..)]`" rule in CLAUDE.md.
6. **SHELL mismatch:** Students use the generic `RoleLayout` (`data-intensity="loud"`), NOT the locked Pop-Art teacher shell. No student-specific shell/component exists.
7. **GROWTH API has no consumer:** `GET /api/student/growth` is fully built + tested but no page renders it (the `/student/growth` page is missing).
8. **DUAL attempt models:** CORE-native quiz attempts (`/api/attempts/[attemptId]/submit`, `quiz_attempts`/`quiz_responses`) are distinct from SPARK challenges (`spark_completions`, completed via the SPARK→CORE webhook). The design must be explicit about which path the new student app drives.
