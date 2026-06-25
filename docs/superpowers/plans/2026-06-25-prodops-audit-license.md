# Production Ops — Audit Log + Soft License Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Record who did each sensitive staff action (grade change, un-enroll, roster/account creation, admin provisioning) in an append-only audit log, and extend the existing seat-cap so pilot (trialing) schools can't enroll past their license limit — without ever freezing an active classroom.

**Architecture:** A lean `audit_logs` table + a best-effort `logAudit()` helper, called opt-in at the route/cron level (libs stay pure — callers log using returned summaries). One DDL line widens the existing `enforce_enrollment_limit` trigger from `status='active'` to `status IN ('active','trialing')`. No new middleware; bolts onto the existing `getUser → role → guard → admin` chain.

**Tech Stack:** Next.js 16 App Router (route handlers; `after` from `next/server`), TypeScript strict, Vitest 4 (node env for libs/routes), Supabase admin client (service-role, bypasses RLS).

> **Hardened by a pre-code adversarial review (2026-06-25).** Fixes folded in: **C1** — `assignments` has NO `school_id` column (it's on `classes`); the override route resolves school via a `classes` lookup, not a widened select (the original would 404 every override). **I1** — `guardPlatformAdmin` doesn't expose the caller id; provision-trial/spark-enable get the actor via `getUser()`. **I2** — `spark.enable` logs only when `ok===true` (the route always returns 200). **I3** — Task 8 test asserts the new 23514 behavior positively + extends the test helper to inject the code. **I4** — roster.import metadata uses the engines' real summary field names. Plus minors (sync insertion point + `actorId:user.id`/cron-null + `skippedOther` observability; stub `logAudit` in existing route tests; never-fatal 200 test).

## Global Constraints
- **Audit logging is best-effort — NEVER fatal.** A `logAudit` failure must not roll back or 500 the originating action (catch + `console.error`, return void).
- **`audit_logs` is append-only + deny-by-default RLS:** service_role FOR ALL (INSERT via admin client), platform_admin SELECT only, NO UPDATE/DELETE policy. Always stamp `school_id` (enables later school-scoped reads). No FKs on `actor_id`/`school_id` — the trail must survive referential deletions.
- **Auth chain unchanged** — no global middleware; opt-in `logAudit` calls after the existing guard passes. Libs stay pure (no audit import); callers log.
- **Seat cap stays pilot-safe** — widening to `trialing` only blocks a genuinely-NEW student past `student_limit` (default 300); never retroactive, never re-enrollment, no-op when the school has no license row.
- **No class freezing** — the gate never blocks grade override / content edits / teaching; only new-enrollment-past-cap.
- **Audit actions in scope (locked):** `grade.override`, `roster.sync`, `roster.import`, `school.provision`, `spark.enable`. NOT high-fives / alert-resolve / quiz-publish.
- **Gates (every task):** `npx tsc --noEmit` → 0; `npx vitest run <file>` → green; full suite + `npm run build` at the end.

**Spec:** `docs/superpowers/specs/2026-06-25-prodops-audit-license-design.md`. **Grounding:** `docs/superpowers/specs/grounding/2026-06-25-prodops/grounding-synthesis.md`.

## File Structure
- **Create** `supabase/migrations/0026_audit_logs.sql` — table + RLS + the trigger widen.
- **Create** `src/lib/audit/logAudit.ts` — the helper + `AuditEntry` type.
- **Modify** `src/app/api/teacher/gradebook/override/route.ts` — log `grade.override` (old→new).
- **Modify** `src/app/api/teacher/google/sync/route.ts` + `src/app/api/cron/gc-roster-sync/route.ts` — log `roster.sync` summary.
- **Modify** `src/app/api/teacher/roster/import/route.ts` + `src/app/api/admin/roster/import/route.ts` — log `roster.import` summary + surface seat-cap (23514) friendly.
- **Modify** `src/app/api/admin/provision-trial/route.ts` + `src/app/api/admin/spark-enable/route.ts` — log `school.provision` / `spark.enable`.
- **Create** `src/app/api/admin/audit/route.ts` — platform_admin read route.
- Tests alongside each.

**Dependency order:** T1, T2 → T3, T4, T5, T6 (independent wire tasks, do sequentially) → T7 (read route) → T8 (seat-cap friendly surfacing).

---

### Task 1: Migration 0026 — `audit_logs` + widen seat cap

DDL only (no unit test). Mirrors 0017 deny-by-default RLS; the trigger body is copied verbatim from `0009_security_hardening.sql:9-59` with ONE line changed.

**Files:** Create `supabase/migrations/0026_audit_logs.sql`
**Interfaces:** Produces `public.audit_logs(id, actor_id, school_id, action, resource_type, resource_id, metadata, created_at)`. Consumed by Tasks 2 & 7.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0026_audit_logs.sql
-- Production ops: append-only audit log for sensitive staff actions + widen the seat-cap
-- trigger to cover trialing (pilot) schools. Additive; no edits to existing tables.
--
-- audit_logs: written ONLY via the admin client (service_role) by logAudit(); read ONLY by
-- platform_admin. Append-only — no UPDATE/DELETE policy. NO FKs on actor_id/school_id so the
-- trail survives user/school deletion. school_id stamped on every row (enables later
-- school-admin-scoped reads via one added policy).
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid,                              -- the staff user; null = system/cron
  school_id     uuid,                              -- the affected school (stamp always)
  action        text        NOT NULL,              -- e.g. 'grade.override', 'roster.sync'
  resource_type text        NOT NULL,              -- e.g. 'homework_attempt', 'class', 'school'
  resource_id   text,                              -- the affected row id (text — heterogeneous)
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- {before,after} for changes; counts for summaries
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_school_created   ON public.audit_logs (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource         ON public.audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_action_created   ON public.audit_logs (action, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_service_role_all" ON public.audit_logs;
CREATE POLICY "audit_service_role_all" ON public.audit_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Platform admins may READ the trail. No INSERT/UPDATE/DELETE policy for authenticated ⇒
-- append-only from the app's perspective; the only writer is the service-role admin client.
DROP POLICY IF EXISTS "audit_platform_read" ON public.audit_logs;
CREATE POLICY "audit_platform_read" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_platform_admin());

GRANT SELECT ON public.audit_logs TO authenticated, anon;
GRANT ALL    ON public.audit_logs TO service_role;

-- ── Widen the seat-cap trigger to cover trialing (pilot) schools ──
-- Verbatim from 0009_security_hardening.sql:9-59 EXCEPT the one status line (active → active+trialing).
-- A school with no matching license row still no-ops (v_limit IS NULL → RETURN NEW), so this is a
-- no-op for unlicensed/demo schools and only bites a trialing school past its student_limit.
CREATE OR REPLACE FUNCTION public.enforce_enrollment_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_school_id    uuid;
  v_current_count integer;
  v_limit        integer;
BEGIN
  IF to_regclass('public.school_licenses') IS NULL THEN RETURN NEW; END IF;
  SELECT school_id INTO v_school_id FROM public.users WHERE id = NEW.student_id;
  IF v_school_id IS NULL THEN RETURN NEW; END IF;
  SELECT student_limit INTO v_limit
    FROM public.school_licenses
   WHERE school_id = v_school_id
     AND status IN ('active','trialing')      -- WIDENED: pilots are enforced too
   LIMIT 1;
  IF v_limit IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(DISTINCT u.id) INTO v_current_count
    FROM public.users u
    JOIN public.enrollments e ON e.student_id = u.id
   WHERE u.school_id = v_school_id AND u.role = 'student' AND u.is_active = true;
  IF v_current_count >= v_limit THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.enrollments e2 JOIN public.users u2 ON u2.id = e2.student_id
       WHERE u2.school_id = v_school_id AND e2.student_id = NEW.student_id
    ) THEN
      RAISE EXCEPTION 'Enrollment limit reached: school has % students, license allows %', v_current_count, v_limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

- [ ] **Step 2: Verify** idempotency (IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE), that the trigger body matches `0009:9-59` except the one widened line, and that there are no FKs on `actor_id`/`school_id`. Do NOT apply to any live DB (separately authorized later).
- [ ] **Step 3: Commit** `feat(prodops): migration 0026 audit_logs + widen seat-cap to trialing`

---

### Task 2: `logAudit` helper

**Files:** Create `src/lib/audit/logAudit.ts`, Test `src/lib/audit/__tests__/logAudit.test.ts`
**Interfaces:** Produces `AuditEntry` + `logAudit(admin, entry): Promise<void>`. Consumed by Tasks 3–7.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/audit/__tests__/logAudit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { logAudit } from '@/lib/audit/logAudit';

function makeAdmin(insertImpl: (rows: unknown) => unknown) {
  const calls: unknown[] = [];
  const admin = { from: (t: string) => ({ insert: (rows: unknown) => { calls.push({ t, rows }); return insertImpl(rows); } }) } as never;
  return { admin, calls };
}

describe('logAudit', () => {
  it('inserts a normalized row into audit_logs', async () => {
    const { admin, calls } = makeAdmin(async () => ({ error: null }));
    await logAudit(admin, { actorId: 'u1', schoolId: 's1', action: 'grade.override', resourceType: 'homework_attempt', resourceId: 'a1', metadata: { before: { x: 1 }, after: { x: 2 } } });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { t: string }).t).toBe('audit_logs');
    expect((calls[0] as { rows: Record<string, unknown> }).rows).toMatchObject({
      actor_id: 'u1', school_id: 's1', action: 'grade.override', resource_type: 'homework_attempt', resource_id: 'a1',
    });
  });
  it('defaults metadata to {} and allows null actor (system/cron)', async () => {
    const { admin, calls } = makeAdmin(async () => ({ error: null }));
    await logAudit(admin, { actorId: null, schoolId: 's1', action: 'roster.sync', resourceType: 'class', resourceId: 'c1' });
    expect((calls[0] as { rows: Record<string, unknown> }).rows).toMatchObject({ actor_id: null, metadata: {} });
  });
  it('NEVER throws when the insert returns an error', async () => {
    const { admin } = makeAdmin(async () => ({ error: { message: 'boom' } }));
    await expect(logAudit(admin, { actorId: 'u1', schoolId: 's1', action: 'x', resourceType: 'y', resourceId: null })).resolves.toBeUndefined();
  });
  it('NEVER throws when the insert itself throws', async () => {
    const { admin } = makeAdmin(() => { throw new Error('network'); });
    await expect(logAudit(admin, { actorId: 'u1', schoolId: 's1', action: 'x', resourceType: 'y', resourceId: null })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run src/lib/audit/__tests__/logAudit.test.ts`).
- [ ] **Step 3: Implement**

```ts
// src/lib/audit/logAudit.ts
// Best-effort append-only audit write. The single writer of public.audit_logs (migration 0026).
// NEVER throws — a logging failure must never roll back or 500 the action being audited.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditEntry {
  actorId: string | null;      // the staff user id; null = system/cron
  schoolId: string | null;     // the affected school (stamp whenever known)
  action: string;              // dotted verb, e.g. 'grade.override'
  resourceType: string;        // e.g. 'homework_attempt' | 'class' | 'school'
  resourceId: string | null;   // the affected row id
  metadata?: Record<string, unknown>; // {before,after} for changes; counts for summaries
}

export async function logAudit(admin: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    const { error } = await admin.from('audit_logs').insert({
      actor_id: entry.actorId,
      school_id: entry.schoolId,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId,
      metadata: entry.metadata ?? {},
    });
    if (error) console.error('[audit] insert failed (non-fatal):', (error as { message?: string }).message ?? error);
  } catch (err) {
    console.error('[audit] insert threw (non-fatal):', err);
  }
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(prodops): logAudit best-effort append-only helper`

---

### Task 3: Wire `grade.override` (old→new)

**Files:** Modify `src/app/api/teacher/gradebook/override/route.ts`, Test `src/app/api/teacher/gradebook/override/__tests__/audit.test.ts` (new — don't disturb any existing route test).

- [ ] **Step 1: Write the failing test** — mock `logAudit` and the supabase clients; drive a successful override; assert `logAudit` was called once with `action:'grade.override'`, `resourceType:'homework_attempt'`, `resourceId: attempt id`, and `metadata.before.teacher_score` = the prior value, `metadata.after.teacher_score` = the new value.

```ts
// src/app/api/teacher/gradebook/override/__tests__/audit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const logAudit = vi.fn();
vi.mock('@/lib/audit/logAudit', () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }));
vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher','school_admin','school_sysadmin','platform_admin'] }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: async () => null }));
vi.mock('@/lib/skills/recomputeSkillStates', () => ({ recomputeSkillStatesForStudent: async () => {} }));
const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: 'teacher' } }) }) }) };
      if (t === 'homework_attempts') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'a1', assignment_id: 'asg1', student_id: 'stu1', status: 'graded', score_pct: 70, teacher_score: null } }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      // assignments has class_id ONLY (no school_id column — verified 0004); school_id is on classes.
      if (t === 'assignments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { class_id: 'c1' } }) }) }) };
      if (t === 'classes') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { school_id: 'sch1' } }) }) }) };
      return {};
    },
  }),
}));

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
beforeEach(() => { logAudit.mockReset(); getUser.mockResolvedValue({ data: { user: { id: 'u1' } } }); });

describe('grade override audit', () => {
  it('logs grade.override with before/after on a successful override', async () => {
    const { POST } = await import('@/app/api/teacher/gradebook/override/route');
    const res = await POST(req({ attempt_id: 'a1', teacher_score: 88 }));
    expect(res.status).toBe(200);
    expect(logAudit).toHaveBeenCalledTimes(1);
    const [, entry] = logAudit.mock.calls[0];
    expect(entry).toMatchObject({ actorId: 'u1', schoolId: 'sch1', action: 'grade.override', resourceType: 'homework_attempt', resourceId: 'a1' });
    expect(entry.metadata.before.teacher_score).toBeNull();
    expect(entry.metadata.after.teacher_score).toBe(88);
  });

  it('still returns 200 + writes the grade even if logAudit rejects (never-fatal)', async () => {
    logAudit.mockRejectedValueOnce(new Error('audit down'));
    const { POST } = await import('@/app/api/teacher/gradebook/override/route');
    const res = await POST(req({ attempt_id: 'a1', teacher_score: 88 }));
    expect(res.status).toBe(200); // a logging failure must never break the override
  });
});
```
(Note: `logAudit` is internally never-throwing, but the route awaiting it must also not let a rejection escape — in practice `logAudit` swallows, so this just pins the contract.)

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Edit the route.** Read the current route first. Import `logAudit`. **Do NOT add `school_id` to the `assignments` select — that column does not exist on `assignments` (it lives on `classes`); selecting it would 404 every override.** Keep `.select('class_id')`. After `guardClassAccess(asg.class_id)` passes, resolve the school from the class:

```ts
    const { data: clsRow } = await admin.from('classes').select('school_id').eq('id', asg.class_id).maybeSingle();
    const schoolId = (clsRow as { school_id?: string | null } | null)?.school_id ?? null;
```

Then, after the successful `homework_attempts.update` (the `if (writeErr) return 500` block), add:

```ts
    await logAudit(admin, {
      actorId: user.id,
      schoolId,
      action: 'grade.override',
      resourceType: 'homework_attempt',
      resourceId: attempt.id,
      metadata: {
        before: { teacher_score: attempt.teacher_score, score_pct: attempt.score_pct },
        after: { teacher_score: hasScore ? body.teacher_score : attempt.teacher_score, allow_redo: hasRedo ? body.allow_redo : undefined, notes_changed: hasNotes },
      },
    });
```

(Place it before the `after(...)` recompute / the final response.)

- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(prodops): audit grade.override (before/after)`

---

### Task 4: Wire `roster.sync` summary (GC reconcile callers)

**Files:** Modify `src/app/api/teacher/google/sync/route.ts` (teacher actor) + `src/app/api/cron/gc-roster-sync/route.ts` (cron, actor=null). Test `__tests__/audit.test.ts` beside one of them (mock `logAudit`).

**Interface note:** `reconcileCourseRoster(admin, args)` returns `ReconcileResult` (counts: `enrolled, reactivated, softRemoved, errors, …`). Log ONE summary per reconcile, only when `softRemoved + reactivated + enrolled > 0`.

- [ ] **Step 1: Write the failing test** — mock `reconcileCourseRoster` to return a result with `softRemoved: 2, reactivated: 1, enrolled: 0, errors: 0`; drive the sync route; assert `logAudit` called with `action:'roster.sync'`, `resourceType:'class'`, `resourceId: classId`, `actorId` = the teacher (and a separate assertion/case that the cron path passes `actorId: null`), `metadata` carrying the counts. Add a case where all counts are 0 → `logAudit` NOT called (quiet no-op).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Edit both callers.** Read each route to find where `reconcileCourseRoster` is called + the in-scope vars. Place the log INSIDE the existing try, immediately after the reconcile `await`, BEFORE the success `return` (else it's dead code). Guard so it stays quiet on a true no-op but stays auditable when the seat cap throttled adds:

```ts
    if (result.softRemoved + result.reactivated + result.enrolled > 0 || result.skippedOther > 0 || result.errors > 0) {
      await logAudit(admin, {
        actorId: <ACTOR>,           // /sync: the authenticated caller user.id (route is STAFF_ROLES-wide — admins may sync; NOT cls.teacher_id). cron: null
        schoolId: <SCHOOL_ID>,      // /sync: the class's school_id in scope; cron: the per-connection school (e.g. c.school_id)
        action: 'roster.sync',
        resourceType: 'class',
        resourceId: <CLASS_ID>,     // /sync: classId; cron: the class id of the row being reconciled (e.g. c.id)
        metadata: { enrolled: result.enrolled, reactivated: result.reactivated, softRemoved: result.softRemoved, skippedOther: result.skippedOther, errors: result.errors, source: 'google' },
      });
    }
```

Use each route's REAL variable names (read them): the **/sync** route — `actorId: user.id`; the **cron** (`gc-roster-sync`) processes many classes in a loop, so log once per reconciled class with `actorId: null` and the cron's real per-iteration class/school vars (e.g. `c.id`/`c.school_id`). `skippedOther` surfaces seat-cap-throttled adds (the gate this epic adds), so include it.

- [ ] **Step 3b: Stub the audit in the EXISTING route/cron tests.** The existing `google/sync` + `gc-roster-sync` test files have a mock admin with no `audit_logs` branch — add `vi.mock('@/lib/audit/logAudit', () => ({ logAudit: vi.fn() }))` to each so the new call decouples from their admin-mock shape (don't rely only on logAudit's internal swallow).

- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(prodops): audit roster.sync summary (teacher + cron)`

---

### Task 5: Wire `roster.import` summary (lean + full)

**Files:** Modify `src/app/api/teacher/roster/import/route.ts` (lean) + `src/app/api/admin/roster/import/route.ts` (full). Test beside each (mock `logAudit`).

- [ ] **Step 1: Write the failing test** — for each route, mock the import engine to return its summary on a `commit`; assert `logAudit` called once with `action:'roster.import'`, `resourceType:'class'` (lean) / `'school'` (full), `resourceId` = class/school id, `metadata` = the created/enrolled counts from the engine summary. (Preview/dry-run mode → NOT logged.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Edit both routes.** Read each route + **its engine's actual return type** (the literal field names differ — `LeanImportSummary` = `{ studentsCreated, studentsExisting, enrolled, alreadyEnrolled, errors, issues }`; the full `ImportSummary` nests `students.created` / `enrollments.created`). On a successful COMMIT only (NOT preview/dry-run), add `logAudit` mapping metadata from the REAL fields:
  - Lean (`teacher/roster/import`): `{ actorId: user.id, schoolId: <class school>, action:'roster.import', resourceType:'class', resourceId: classId, metadata: { studentsCreated: summary.studentsCreated, enrolled: summary.enrolled, errors: summary.errors } }`.
  - Full (`admin/roster/import`): `{ actorId: <platform/admin caller id>, schoolId, action:'roster.import', resourceType:'school', resourceId: schoolId, metadata: { studentsCreated: summary.students.created, enrollmentsCreated: summary.enrollments.created } }`.
  Verify the exact field names against each engine before writing; the Task 5 test must assert the concrete values from the mocked summary (so the metadata mapping is actually covered, not bound to `undefined`).
- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(prodops): audit roster.import summary (lean + full)`

---

### Task 6: Wire `school.provision` + `spark.enable`

**Files:** Modify `src/app/api/admin/provision-trial/route.ts` + `src/app/api/admin/spark-enable/route.ts`. Test beside each (mock `logAudit`).

- [ ] **Step 1: Write the failing test** — drive each route to success (platform_admin; mock `getUser` to return the admin's id); assert `logAudit` called with `action:'school.provision'` / `'spark.enable'`, `resourceType:'school'`, `resourceId` = the school id, `actorId` = the admin's id, `metadata` (provision: `{school_name, teacher_email}`; spark: `{school_id}`). For spark-enable, add a case where the enable FAILED (`ok===false`) → `logAudit` NOT called.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Edit both routes.** **`guardPlatformAdmin()` returns only `NextResponse | null` — it does NOT expose the caller id**, and neither route currently calls `getUser`. So after the guard passes, obtain the actor explicitly in each route: add `import { createServerSupabaseClient } from '@/lib/supabase/server';` (both routes currently import only `createAdminSupabaseClient`), then `const supabase = await createServerSupabaseClient(); const { data: { user } } = await supabase.auth.getUser();` and use `actorId: user?.id ?? null`.
  - **provision-trial** returns 201 only on success → log after the successful provision: `{ actorId: user?.id ?? null, schoolId: <new school id>, action:'school.provision', resourceType:'school', resourceId: <new school id>, metadata:{ school_name, teacher_email } }`.
  - **spark-enable** ALWAYS returns 200 with an `ok` boolean (it captures per-step failures in `steps` but never returns non-200) → log ONLY when `ok === true`: `if (ok) await logAudit(admin, { actorId: user?.id ?? null, schoolId: school.id, action:'spark.enable', resourceType:'school', resourceId: school.id, metadata:{ school_id: school.id } });` Read the route for the real `ok`/`school` variable names.
- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(prodops): audit school.provision + spark.enable`

---

### Task 7: Platform-admin audit read route

**Files:** Create `src/app/api/admin/audit/route.ts`, Test `__tests__/route.test.ts`.

- [ ] **Step 1: Write the failing test** — 401 no user; 403 non-platform (mock `guardPlatformAdmin` returning a 403 NextResponse); 200 + rows for platform_admin; confirm the query filters by `school_id`/`action`/`resource_type` query params when present, orders by `created_at desc`, and caps results.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

```ts
// src/app/api/admin/audit/route.ts
// GET — platform_admin reads the audit trail. No UI this epic; this answers "who did X, when?".
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardPlatformAdmin } from '@/lib/auth/guards';

const MAX = 200;

export async function GET(req: Request) {
  const guard = await guardPlatformAdmin();
  if (guard) return guard;
  const url = new URL(req.url);
  const schoolId = url.searchParams.get('school_id');
  const action = url.searchParams.get('action');
  const resourceType = url.searchParams.get('resource_type');
  const admin = createAdminSupabaseClient();
  let q = admin.from('audit_logs')
    .select('id, actor_id, school_id, action, resource_type, resource_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(MAX);
  if (schoolId) q = q.eq('school_id', schoolId);
  if (action) q = q.eq('action', action);
  if (resourceType) q = q.eq('resource_type', resourceType);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}
```

- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(prodops): platform-admin GET /api/admin/audit read route`

---

### Task 8: Friendly seat-cap surfacing on imports

The widened trigger raises `check_violation` (SQLSTATE `23514`) when a NEW student would exceed `student_limit`. `reconcileCourseRoster` already handles 23514 (counts it as `skippedOther`, not an error — `reconcileCourseRoster.ts:194-198`). The import engines already catch + sanitize generic DB errors (no raw leak), so the ONLY new behavior is a **23514-specific friendly "seat limit reached" message** counted as a skip (not an error).

**Files:** Modify `src/lib/roster/importStudentsToClass.ts` + `src/lib/roster/importRoster.ts` (whichever do the `enrollments.insert`/`upsert`). Test beside each.

- [ ] **Step 1: Write the failing test (assert the NEW behavior positively, so it's RED before the branch exists).** Extend the engine's test helper to let the enrollment insert return a `code` (e.g. an `enrollInsertCode` option) — the existing `fakeAdmin` returns `{ error: { message } }` with NO `code`, so the `code === '23514'` branch is never reached otherwise. Then mock the insert to return `{ error: { code: '23514', message: 'Enrollment limit reached…' } }` and assert BOTH: `summary.issues` contains a message matching `/seat limit reached/i` AND `summary.errors === 0` (23514 is a skip, not an error — mirroring reconcile). (Asserting "not thrown / not raw-leaked" alone is invalid TDD — those already pass.)
- [ ] **Step 2: Run → FAIL** (no 23514 branch yet → it lands in the generic-error path, so `errors` ≠ 0 / the friendly string is absent).
- [ ] **Step 3: Edit the engines.** In each engine's enrollment-write `{ error }` branch, add a `code === '23514'` case BEFORE the generic-error handling: record a sanitized issue ("Seat limit reached for this school's license") and count it as a skip (do NOT increment `errors`), then continue. Mirror `reconcileCourseRoster.ts:194-198`.
- [ ] **Step 4: Run → PASS** + tsc 0.
- [ ] **Step 5: Commit** `feat(prodops): surface seat-cap (23514) as a friendly message on imports`

---

## Final verification
- [ ] `npx tsc --noEmit` 0; `npm test` green; `npm run build` 0.
- [ ] Whole-branch adversarial review — focus: logAudit never-fatal (no write site can 500/rollback on a logging failure); append-only RLS correct (no UPDATE/DELETE policy, platform-only read); trigger widen is verbatim-except-one-line and no-ops for unlicensed schools; actor correctness (cron=null, routes=user.id); no raw DB error leaked by the 23514 surfacing or the read route.
- [ ] Apply 0026 to NEW CORE (separately authorized) + functional verify: a `logAudit` write lands a row; the seat cap fires for a trialing school past limit; advisors stay all-WARN. No Playwright (no new UI).

## Self-Review
**Spec coverage:** audit table+RLS+trigger (T1), helper (T2), the 5 locked actions — grade.override (T3), roster.sync (T4), roster.import (T5), school.provision+spark.enable (T6); read route (T7); soft-gate friendly surfacing (T8). Deferred items (expiry gate, auto-suspend, provisioning-over-plan, audit UI) correctly absent. ✓
**Placeholders:** T1/T2/T7 have complete code; T3 has complete code; T4/T5/T6/T8 give the exact `logAudit` call + action/metadata and name the bounded "read the route for its real var names" touchpoint (the actor/summary vars differ per route) — not open-ended. ✓
**Type consistency:** `AuditEntry` (T2) consumed unchanged in T3–T6; `ReconcileResult` counts (T4) match the real return; read route selects the table's real columns (T1). ✓
