# Plan 4b Hardening — Round 2 (Codex findings)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the 3 actionable Codex findings (C1–C3) from the post-merge cross-model review of `fix/4b-hardening`. C4 (incomplete cascade graph) is a separate migration ticket, NOT in this plan.

**Architecture:** Pure TypeScript lib changes + tests. No migrations, no new env vars, no live DB. Vitest node env.

**Branch:** `fix/4b-hardening-round2` (off `main` @ 734390c).

## Global Constraints

- **Service-role bypasses RLS — `ensureAuthUser`'s throw IS the IDOR backstop. Do not weaken the existing rebind guard.** Round-2 only ADDS rollback + audit-durability; the strict `existing.school_id === school_id` match, the `isNewAuthUser` insert gate, and the orphan throw all stay exactly as they are.
- **Soft-fail contract:** `seedTrialDemoData` must still NEVER throw and must still return a `SeedReport`. C1 only makes returned-`{error}` failures *observable* (counted into the existing per-step failCount) — it must not change the no-throw contract or the seed's happy path.
- Vitest **node env** for all lib tests (no `@vitest-environment jsdom`, no `setup-dom`). Single-file run: `npx vitest run <path>`.
- `"Assignments"` never `"Homework"` in copy; DB identifier `homework_attempts` is legacy, do not rename.
- Commit after each task with the exact message in its Step 5.

---

## Task 1 — C1: make returned-`{error}` failures observable in `seedTrialDemoData`

**Finding:** Six steps `await` a Supabase write WITHOUT destructuring `{ error }`. Supabase returns `{ error }` (does not throw), so the surrounding `try/catch` never fires and the step's `failCount` stays 0 → the step is recorded as `seeded` even though the write failed. The `quiz_questions` inner loop logs `qErr` but never counts it, so `quiz` records `ok` even if all questions fail.

**Files:**
- Edit: `src/lib/trial/seedTrialDemoData.ts`
- Edit: `src/lib/trial/__tests__/seedTrialDemoData.test.ts`

**Interfaces:** No signature changes. `SeedReport` shape unchanged.

**The 6 unchecked awaits to fix** (destructure `{ error }`, and `if (error) throw error;` INSIDE the existing per-item `try` so the existing `catch` increments the step's failCount):
1. Step 3 enrollments — `await admin.from('enrollments').upsert(...)`
2. Step 4 guardian — BOTH `await admin.from('users').update({ parent_id }).eq('id', alexId)` AND `await admin.from('guardians').upsert(...)`
3. Step 7 quiz_attempts — `await admin.from('quiz_attempts').insert(...)`
4. Step 9b skill_learning_state — `await admin.from('skill_learning_state').upsert(...)`
5. Step 9c misconceptions — `await admin.from('misconception_observations').insert(...)`
6. Step 10 snapshots — `await admin.from('student_model_snapshots').upsert(...)`

**Plus quiz_questions** (Step 6): the inner loop already destructures `qErr`. Add a `qqFailCount`; on `qErr`, increment it. After the question loop, if `qqFailCount > 0`, treat the `quiz` step as a skip: call `recordSkip('quiz', \`${qqFailCount}/${rows.quiz_questions.length} quiz_questions failed: ${qqFirstError}\`)` INSTEAD OF `recordOk('quiz')`. (The quiz row itself succeeded, but the step is not fully seeded — surface it.)

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/trial/__tests__/seedTrialDemoData.test.ts`. Extend the mock factory so a chosen table's write returns `{ error }` (NOT throws). Pattern — a new helper that returns `{ error }` for a named table's `insert`/`upsert`/`update`:

```ts
// Returns an admin mock whose insert/upsert/update on `errorTable` resolves { error } (no throw).
function makeReturnedErrorAdmin(errorTable: string, errMsg = 'returned error') {
  const op = (table: string) => async () => ({ error: table === errorTable ? { message: errMsg } : null });
  return {
    from: vi.fn((table: string) => ({
      insert: vi.fn(op(table)),
      upsert: vi.fn(op(table)),
      update: vi.fn(() => ({ eq: vi.fn(op(table)) })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ is: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })), maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
          is: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
    auth: { admin: {
      createUser: vi.fn(async () => ({ data: { user: { id: 'stu-' + Math.random() } }, error: null })),
      listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      deleteUser: vi.fn(async () => ({ error: null })),
    } },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

const seedInput = (admin: import('@supabase/supabase-js').SupabaseClient) => ({
  admin, schoolId: 'school-1', schoolIdShort: 'school-1'.slice(0, 8),
  teacherId: 'teacher-1', firstStudentId: 'student-1', parentId: 'parent-1', password: 'TestPass#1234',
});

describe('seedTrialDemoData — returned {error} is observable (C1)', () => {
  it.each([
    ['enrollments', 'enrollments'],
    ['quiz_attempts', 'quiz_attempts'],
    ['skill_learning_state', 'skill_learning_state'],
    ['misconception_observations', 'misconceptions'],
    ['student_model_snapshots', 'snapshots'],
  ])('a returned {error} on %s lands the %s step in skipped (not seeded)', async (table, step) => {
    const admin = makeReturnedErrorAdmin(table);
    const report = await seedTrialDemoData(seedInput(admin));
    expect(report.skipped.some((s) => s.step === step), `${step} should be skipped`).toBe(true);
    expect(report.seeded).not.toContain(step);
  });

  it('a returned {error} on guardians lands guardian_link in skipped', async () => {
    const admin = makeReturnedErrorAdmin('guardians');
    const report = await seedTrialDemoData(seedInput(admin));
    expect(report.skipped.some((s) => s.step === 'guardian_link')).toBe(true);
    expect(report.seeded).not.toContain('guardian_link');
  });

  it('a returned {error} on quiz_questions lands the quiz step in skipped', async () => {
    const admin = makeReturnedErrorAdmin('quiz_questions');
    const report = await seedTrialDemoData(seedInput(admin));
    expect(report.skipped.some((s) => s.step === 'quiz')).toBe(true);
    expect(report.seeded).not.toContain('quiz');
  });

  it('still never throws even when a step returns {error}', async () => {
    const admin = makeReturnedErrorAdmin('snapshots');
    await expect(seedTrialDemoData(seedInput(admin))).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run the new tests; confirm they FAIL** (steps wrongly land in `seeded`):
`npx vitest run src/lib/trial/__tests__/seedTrialDemoData.test.ts`

- [ ] **Step 3: Implement** — for each of the 6 unchecked awaits, change e.g.
```ts
await admin.from('enrollments').upsert({ ... }, { onConflict: 'class_id,student_id' });
```
to
```ts
const { error } = await admin.from('enrollments').upsert({ ... }, { onConflict: 'class_id,student_id' });
if (error) throw error;
```
(Use a distinct local name where two awaits share a try — e.g. guardian step: `const { error: upErr } = await admin.from('users').update(...).eq(...); if (upErr) throw upErr; const { error: gErr } = await admin.from('guardians').upsert(...); if (gErr) throw gErr;`.) For quiz_questions: add `let qqFailCount = 0; let qqFirstError = '';`, on `qErr` do `qqFailCount++; if (!qqFirstError) qqFirstError = qErr.message;`, and after the loop branch `recordOk`/`recordSkip('quiz', ...)` on `qqFailCount`.

- [ ] **Step 4: Run tests; confirm ALL pass** (new + existing):
`npx vitest run src/lib/trial/__tests__/seedTrialDemoData.test.ts`

- [ ] **Step 5: Commit**
```bash
git add src/lib/trial/seedTrialDemoData.ts src/lib/trial/__tests__/seedTrialDemoData.test.ts
git commit -m "fix(trial): seedTrialDemoData counts returned {error} into SeedReport (C1 — observable Supabase failures)"
```

---

## Task 2 — C2 + C3: rollback orphaned auth user + durable rebind audit

**C2 finding:** In `ensureAuthUser`, if `createUser` creates a NEW auth user but the subsequent `public.users` INSERT returns `{ error }` (thrown), the caller's cleanup deletes only the school. The `auth.users` entry lingers (not cascade-covered), and on retry the orphan guard throws "manual remediation" — permanently wedging that email.

**C3 finding:** The `rebind_refused` audit (`logTrialEvent` → `trial_events.school_id` = the just-created trial school) is CASCADE-deleted when `provisionTrial` then deletes that school (`trial_events.school_id ON DELETE CASCADE`). The security audit of a refused rebind is not durable.

**Files:**
- Edit: `src/lib/trial/ensureAuthUser.ts`
- Edit: `src/lib/trial/logTrialEvent.ts`
- Edit: `src/lib/trial/__tests__/ensureAuthUser.test.ts`

**Interfaces:**
```ts
// logTrialEvent.ts — schoolId now accepts null (a platform-level breadcrumb not tied to a school)
export interface LogTrialEventParams {
  admin: SupabaseClient;
  schoolId: string | null;   // was: string
  userId?: string | null;
  eventType: string;
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 1: Write the failing tests** (add to `ensureAuthUser.test.ts`):

```ts
it('rolls back the created auth user when the public.users insert fails (C2)', async () => {
  const deleteUser = vi.fn(async () => ({ error: null }));
  const fromMock = vi.fn(() => ({
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
    insert: vi.fn(async () => ({ error: { message: 'insert boom' } })), // returns {error}
    update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
  }));
  const admin = {
    auth: { admin: {
      createUser: vi.fn(async () => ({ data: { user: { id: 'new-auth-1' } }, error: null })),
      listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      deleteUser,
    } },
    from: fromMock,
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  await expect(ensureAuthUser({
    admin, email: 'new@school.com', password: 'pw', full_name: 'New', role: 'teacher', school_id: 'school-1',
  })).rejects.toThrow(/insert boom/i);
  expect(deleteUser).toHaveBeenCalledWith('new-auth-1'); // orphan rolled back
});

it('rebind_refused audit is logged with a null schoolId so it survives school-delete cascade (C3)', async () => {
  vi.mocked(logTrialEvent).mockClear();
  const fromMock = makeFromAdmin({ id: 'existing-auth-id', role: 'student', school_id: 'school-1' });
  const admin = {
    auth: { admin: makeCreateUserAdmin({ createdId: null, errorMsg: 'User already registered' }) },
    from: fromMock,
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  await expect(ensureAuthUser({
    admin, email: 'taken@school.com', password: 'pw', full_name: 'X', role: 'teacher', school_id: 'school-1',
  })).rejects.toThrow();

  const call = vi.mocked(logTrialEvent).mock.calls[0][0];
  expect(call.schoolId).toBeNull();                          // durable: not tied to the soon-deleted school
  expect(call.metadata).toMatchObject({ audit_action: 'rebind_refused', requested_school_id: 'school-1' });
});
```
(Reuse the file's existing `makeFromAdmin` / `makeCreateUserAdmin` helpers. The C2 test uses its own inline admin because it needs an insert that RETURNS `{error}`.)

- [ ] **Step 2: Run; confirm the two new tests FAIL** (no deleteUser call; audit currently uses `school_id` not null):
`npx vitest run src/lib/trial/__tests__/ensureAuthUser.test.ts`

- [ ] **Step 3: Implement.**

In `src/lib/trial/logTrialEvent.ts`, change `schoolId: string` → `schoolId: string | null` in `LogTrialEventParams`. No other change (the insert already sets `school_id: schoolId`; null is valid — the column is nullable).

In `src/lib/trial/ensureAuthUser.ts`:
- **C2** — the `else if (isNewAuthUser)` insert branch:
```ts
} else if (isNewAuthUser) {
  const { error: insErr } = await admin
    .from('users')
    .insert({ id, email, full_name, role, school_id });
  if (insErr) {
    // Roll back the auth user we just created so we don't strand an orphaned
    // auth.users entry (not cascade-covered) that would wedge retries via the
    // orphan guard below. Best-effort: still throw the original insert error.
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) console.error(`[ensureAuthUser] rollback deleteUser(${id}) failed:`, delErr.message);
    throw insErr;
  }
}
```
- **C3** — in the rebind-mismatch audit call, change `schoolId: school_id` to `schoolId: null` (keep everything else; `requested_school_id` already carries the attempted school in metadata):
```ts
await logTrialEvent({
  admin,
  schoolId: null,   // durable: a refused rebind must outlive the trial school's cleanup cascade
  eventType: 'trial_signup',
  metadata: {
    audit_action: 'rebind_refused',
    email,
    requested_role: role,
    requested_school_id: school_id,
    existing_role: existing.role,
    existing_school_id: existing.school_id,
  },
});
```

- [ ] **Step 4: Run; confirm ALL pass** (new + existing ensureAuthUser tests):
`npx vitest run src/lib/trial/__tests__/ensureAuthUser.test.ts`

- [ ] **Step 5: Commit**
```bash
git add src/lib/trial/ensureAuthUser.ts src/lib/trial/logTrialEvent.ts src/lib/trial/__tests__/ensureAuthUser.test.ts
git commit -m "fix(trial): rollback orphaned auth user on insert-fail (C2) + durable null-school rebind audit (C3)"
```

---

## Task 3 — Verify whole branch

- [ ] `npx tsc --noEmit` → CLEAN.
- [ ] `npx vitest run src/lib/trial/__tests__/ src/app/api/admin/provision-trial/__tests__/` → all pass.
- [ ] `npm run lint` → 0 errors.
- [ ] Commit nothing (verification only); proceed to final whole-branch review.

## Self-Review

- C1: 6 unchecked awaits + quiz_questions counted; tests assert each lands in `skipped`, and that the no-throw contract holds. ✓
- C2: insert-fail rolls back the created auth user (deleteUser); test asserts deleteUser called + throw preserved. The orphan guard itself is unchanged. ✓
- C3: rebind audit uses `schoolId: null` (survives cascade), `requested_school_id` in metadata; logTrialEvent signature widened to `string | null`. Provision's *success* `trial_signup` breadcrumb (in provisionTrial.ts) is unchanged — still tied to the surviving school. ✓
- No migration changes (C4 = separate ticket). No new env vars. ✓
