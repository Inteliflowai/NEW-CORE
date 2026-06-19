# Auth Chain Grounding — Plan 4b Task 02

Source snapshot taken: 2026-06-19  
Files read verbatim: `src/lib/supabase/server.ts`, `src/lib/auth/guards.ts`, `src/lib/auth/roles.ts`,
`src/app/api/teacher/class/[classId]/roster-signals/route.ts`

---

## 1. `src/lib/supabase/server.ts` — Exact exports and env vars

### Exported functions

| Function | Signature | Returns |
|---|---|---|
| `createServerSupabaseClient` | `async function createServerSupabaseClient()` | `Promise<SupabaseClient>` (async — awaits `cookies()`) |
| `createAdminSupabaseClient` | `function createAdminSupabaseClient()` | `SupabaseClient` (synchronous) |

### Env vars read

**`createServerSupabaseClient`** reads:
- `process.env.NEXT_PUBLIC_SUPABASE_URL`
- `process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

**`createAdminSupabaseClient`** reads:
- `process.env.NEXT_PUBLIC_SUPABASE_URL`
- `process.env.SUPABASE_SECRET_KEY`

### Full file verbatim

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function createServerSupabaseClient() {
  const cookieStore = await cookies(); // Next 16: cookies() is async
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error(`Missing Supabase env vars. URL: ${!!url}, KEY: ${!!key}`);

  const client = createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch { /* called from a Server Component — middleware refreshes the session */ }
      },
    },
  });
  if (!client?.auth) throw new Error('createServerClient returned no auth surface — check @supabase/ssr version');
  return client;
}

/** Service-role client. SERVER-ONLY — never import from client code. BYPASSES RLS;
 *  every cross-user read MUST pair with an object-level guard (src/lib/auth/guards.ts). */
export function createAdminSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  );
}
```

---

## 2. `src/lib/auth/roles.ts` — Canonical roles

```ts
export const ROLES = [
  'teacher', 'student', 'parent', 'school_admin', 'school_sysadmin', 'platform_admin',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles routed through the School Admin route group + passing guardSchoolAdmin. */
export const SCHOOL_ADMIN_ROLES = ['school_admin', 'school_sysadmin', 'platform_admin'] as const;
```

`SCHOOL_ADMIN_ROLES` = `['school_admin', 'school_sysadmin', 'platform_admin']`  
`STAFF_ROLES` (local to roster-signals route) = `new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'])`

---

## 3. `src/lib/auth/guards.ts` — Exact function signatures and return shapes

### `guardClassAccess`

```ts
export async function guardClassAccess(classId: string): Promise<NextResponse | null>
```

- Returns `null` → caller is allowed to proceed.
- Returns `NextResponse` (401 or 403) → caller must short-circuit: `if (guard) return guard;`
- Logic: platform_admin → pass; teacher who owns the class → pass; same-school admin → pass; else 403.

### `guardStudentAccess`

```ts
export async function guardStudentAccess(studentId: string): Promise<NextResponse | null>
```

- Returns `null` → caller is allowed to proceed.
- Returns `NextResponse` (401 or 403) → short-circuit.
- Logic: student themselves → pass; platform_admin → pass; same-school admin → pass; parent with matching `parent_id` → pass; teacher enrolled in one of caller's classes → pass; else 403.

### `guardPlatformAdmin`

```ts
export async function guardPlatformAdmin(): Promise<NextResponse | null>
```

### `guardSchoolAdmin`

```ts
export async function guardSchoolAdmin(): Promise<
  | { error: NextResponse }
  | { schoolId: string | null; role: string; userId: string; isPlatformAdmin: boolean }
>
```

Short-circuit pattern: `if ('error' in r) return r.error;`

### Exported role sets (from `src/lib/auth/roles.ts`, imported by guards.ts)

- `SCHOOL_ADMIN_ROLES` (from `@/lib/auth/roles`): `['school_admin', 'school_sysadmin', 'platform_admin']`
- No `STAFF_ROLES` or `TEACHER_ROLES` is exported from `guards.ts` or `roles.ts`; `STAFF_ROLES` is a **module-local** `Set` defined only inside the roster-signals route.

### Full file verbatim

```ts
// Object-level authz for API route handlers (LIFT V1 lib/auth/guards.ts; finding C3).
// The service-role admin client BYPASSES RLS — these guards are the ONLY access
// control on admin-client cross-user reads. RLS is NOT the backstop here.
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { SCHOOL_ADMIN_ROLES } from '@/lib/auth/roles';

const PLATFORM_ROLE = 'platform_admin';

function isSchoolAdmin(role: string | null): boolean {
  return !!role && (SCHOOL_ADMIN_ROLES as readonly string[]).includes(role);
}

const UNAUTH = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
const FORBID = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 });

/** Resolve the authenticated caller's id + role from the session, or null. */
async function resolveCaller(): Promise<{ id: string; role: string | null; school_id: string | null } | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser(); // getUser, not getSession
  if (!user) return null;
  const { data: profile } = await supabase
    .from('users').select('role, school_id').eq('id', user.id).single();
  return { id: user.id, role: profile?.role ?? null, school_id: profile?.school_id ?? null };
}

export async function guardPlatformAdmin(): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (!caller) return UNAUTH();
  if (caller.role !== PLATFORM_ROLE) return FORBID();
  return null;
}

export async function guardSchoolAdmin(): Promise<
  | { error: NextResponse }
  | { schoolId: string | null; role: string; userId: string; isPlatformAdmin: boolean }
> {
  const caller = await resolveCaller();
  if (!caller) return { error: UNAUTH() };
  if (!(SCHOOL_ADMIN_ROLES as readonly string[]).includes(caller.role as string)) {
    return { error: FORBID() };
  }
  const isPlatformAdmin = caller.role === PLATFORM_ROLE;
  return { schoolId: caller.school_id, role: caller.role as string, userId: caller.id, isPlatformAdmin };
}

export async function guardClassAccess(classId: string): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (!caller) return UNAUTH();
  if (caller.role === PLATFORM_ROLE) return null;
  const admin = createAdminSupabaseClient();
  const { data: cls } = await admin.from('classes').select('teacher_id, school_id').eq('id', classId).maybeSingle();
  if (!cls) return FORBID(); // 403 not 404 — don't leak existence
  if (cls.teacher_id === caller.id) return null;
  if (isSchoolAdmin(caller.role) && cls.school_id && cls.school_id === caller.school_id) return null;
  return FORBID();
}

export async function guardStudentAccess(studentId: string): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (!caller) return UNAUTH();
  if (caller.id === studentId) return null;
  if (caller.role === PLATFORM_ROLE) return null;
  const admin = createAdminSupabaseClient();
  const { data: stu } = await admin.from('users').select('school_id, parent_id').eq('id', studentId).maybeSingle();
  if (!stu) return FORBID();
  if (isSchoolAdmin(caller.role) && stu.school_id && stu.school_id === caller.school_id) return null;
  if (caller.role === 'parent' && stu.parent_id === caller.id) return null;
  if (caller.role === 'teacher') {
    const { data: classes } = await admin.from('classes').select('id').eq('teacher_id', caller.id);
    const classIds = (classes ?? []).map((c: { id: string }) => c.id);
    if (classIds.length) {
      const { data: enr } = await admin
        .from('enrollments').select('id').eq('student_id', studentId).in('class_id', classIds).limit(1).maybeSingle();
      if (enr) return null;
    }
  }
  return FORBID();
}
```

---

## 4. Canonical auth-chain template (from `roster-signals/route.ts`)

Copy-paste template for any new teacher-facing API route:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';

/** Staff roles that are allowed to see teacher-facing roster data. */
const STAFF_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ classId: string }> },
): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. C8 STAFF ROLE GATE (BEFORE object guard) ────────────────────────────
  const { data: callerProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  const callerRole = callerProfile?.role ?? null;
  if (!callerRole || !STAFF_ROLES.has(callerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { classId } = await params;

  // ── 3. Object-level IDOR guard ─────────────────────────────────────────────
  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  const admin = createAdminSupabaseClient();

  // ... business logic using admin client ...
}
```

### Key details

- `params` is typed as `Promise<{ classId: string }>` and must be awaited: `const { classId } = await params;`
- `STAFF_ROLES` literal members: `'teacher'`, `'school_admin'`, `'school_sysadmin'`, `'platform_admin'`
- Role gate happens **before** `await params` and **before** `guardClassAccess`
- `guardClassAccess` returns `null` on pass or a `NextResponse` on deny; check with `if (guard) return guard;`
- After passing auth, use `createAdminSupabaseClient()` (synchronous) for all DB reads

---

## 5. Summary of verified facts

| Claim | Verified value |
|---|---|
| `createAdminSupabaseClient` reads `SUPABASE_SECRET_KEY` | YES — `process.env.SUPABASE_SECRET_KEY!` |
| SSR client reads `NEXT_PUBLIC_SUPABASE_URL` | YES |
| SSR client reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | YES (not `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `createServerSupabaseClient` is async | YES — `export async function`, awaits `cookies()` |
| `createAdminSupabaseClient` is async | NO — synchronous `function` |
| `guardClassAccess(classId: string)` returns `Promise<NextResponse \| null>` | YES |
| `guardStudentAccess(studentId: string)` returns `Promise<NextResponse \| null>` | YES |
| `STAFF_ROLES` exported from guards.ts | NO — module-local to roster-signals route only |
| `SCHOOL_ADMIN_ROLES` exported from roles.ts | YES — `['school_admin', 'school_sysadmin', 'platform_admin']` |
