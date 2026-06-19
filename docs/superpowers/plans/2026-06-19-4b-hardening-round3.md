# Plan 4b Hardening — Round 3 (complete cascade graph + residual minors)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the remaining 4b-hardening backlog: **C4** (complete the school-child FK `ON DELETE CASCADE` graph so deleting a school cleanly cascades) in the migration files, plus 3 residual low-severity lib fixes (quiz-step record-once hardening, C2 `deleteUser` try/catch, `ensureAuthUser` existing-row `update` `{error}` check). A SEPARATE operational step (not in this plan, done by the controller after merge) reconciles the LIVE "NEW CORE" DB, whose schema predates even round-1's cascades.

**Architecture:** Migration-file edits validated by static SQL-text tests (no live DB) + two small TypeScript lib changes. Vitest node env.

**Branch:** `fix/4b-hardening-round3` (off `main` @ 381272c).

## Global Constraints

- **No live DB in tests.** Migration changes are validated ONLY by static `readFileSync` + `toMatch`/`toContain` assertions in `supabase/migrations/__tests__/migrations.test.ts`.
- **Do not weaken `ensureAuthUser`'s IDOR guard.** Round-3 only ADDS a try/catch around the existing rollback and an `{error}` check on the existing-row `update`. The strict school match, `isNewAuthUser` gate, and orphan throw are untouched.
- **Soft-fail contract:** `seedTrialDemoData` still never throws and still returns a `SeedReport`.
- Vitest node env (no jsdom header / no setup-dom). `"Assignments"` not `"Homework"` in copy; `homework_attempts` is a legacy DB identifier — keep it.
- Commit after each task with its exact Step-5 message.

---

## Task 1 — C4: complete the school-child `ON DELETE CASCADE` graph (migration files)

**Finding (C4, Codex + opus converged):** Only the direct `school_id` FKs (and a few originals) cascade. The transitive children (`guardians`, `enrollments`, `lessons`, `quizzes`, `quiz_attempts`, `assignments`, `homework_attempts`, and `classes.teacher_id`) are still `NO ACTION`, so deleting a *seeded* school raises an FK violation instead of cascading.

**Files:**
- Edit: `supabase/migrations/0001_identity_roles.sql`
- Edit: `supabase/migrations/0002_classes_enrollments.sql`
- Edit: `supabase/migrations/0003_lessons_quizzes.sql`
- Edit: `supabase/migrations/0004_assignments_homework.sql`
- Edit: `supabase/migrations/__tests__/migrations.test.ts`

**The 17 FK lines to change (exact current → add `ON DELETE CASCADE`):**

`0001_identity_roles.sql`:
- L65 `  parent_id  uuid NOT NULL REFERENCES public.users(id),` → `  parent_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,` *(this is the `guardians.parent_id` line — confirm it is inside the `guardians` table block, NOT `users.parent_id` at L50, which must be LEFT UNCHANGED)*
- L66 `  student_id uuid NOT NULL REFERENCES public.users(id),` → `  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,` *(guardians.student_id)*

`0002_classes_enrollments.sql`:
- L14 `  teacher_id                uuid        REFERENCES public.users(id),` → `... REFERENCES public.users(id) ON DELETE CASCADE,` *(classes.teacher_id)*
- L30 `  class_id    uuid        NOT NULL REFERENCES public.classes(id),` → `... REFERENCES public.classes(id) ON DELETE CASCADE,` *(enrollments.class_id)*
- L31 `  student_id  uuid        NOT NULL REFERENCES public.users(id),` → `... REFERENCES public.users(id) ON DELETE CASCADE,` *(enrollments.student_id)*

`0003_lessons_quizzes.sql`:
- L9 `  class_id       uuid        NOT NULL REFERENCES public.classes(id),` → `... ON DELETE CASCADE,` *(lessons.class_id)*
- L10 `  teacher_id     uuid        NOT NULL REFERENCES public.users(id),` → `... ON DELETE CASCADE,` *(lessons.teacher_id)*
- L26 `  lesson_id      uuid        REFERENCES public.lessons(id),` → `... ON DELETE CASCADE,` *(quizzes.lesson_id)*
- L27 `  class_id       uuid        NOT NULL REFERENCES public.classes(id),` → `... ON DELETE CASCADE,` *(quizzes.class_id)*
- L28 `  teacher_id     uuid        NOT NULL REFERENCES public.users(id),` → `... ON DELETE CASCADE,` *(quizzes.teacher_id)*
- L55 `  quiz_id        uuid        NOT NULL REFERENCES public.quizzes(id),` → `... ON DELETE CASCADE,` *(quiz_attempts.quiz_id)*
- L56 `  student_id     uuid        NOT NULL REFERENCES public.users(id),` → `... ON DELETE CASCADE,` *(quiz_attempts.student_id)*
- *(L41 quiz_questions.quiz_id and L72 quiz_responses.attempt_id are ALREADY `ON DELETE CASCADE` — leave. L73 quiz_responses.question_id stays NO ACTION — leave.)*

`0004_assignments_homework.sql`:
- L7 `  student_id              uuid NOT NULL REFERENCES public.users(id),` → `... ON DELETE CASCADE,` *(assignments.student_id)*
- L8 `  class_id                uuid NOT NULL REFERENCES public.classes(id),` → `... ON DELETE CASCADE,` *(assignments.class_id)*
- L9 `  lesson_id               uuid REFERENCES public.lessons(id),` → `... ON DELETE CASCADE,` *(assignments.lesson_id)*
- L26 `  assignment_id     uuid NOT NULL REFERENCES public.assignments(id),` → `... ON DELETE CASCADE,` *(homework_attempts.assignment_id)*
- L27 `  student_id        uuid NOT NULL REFERENCES public.users(id),` → `... ON DELETE CASCADE,` *(homework_attempts.student_id)*
- *(L6 assignments.quiz_attempt_id stays NO ACTION — out of scope; nullable, deleted via class cascade.)*

**Interfaces:** No TypeScript changes.

- [ ] **Step 1: Write the failing tests** — add table-scoped assertions to `migrations.test.ts`. Use a `[\s\S]*?` anchor from the table name so each assertion targets the right FK (several tables share `student_id REFERENCES public.users(id)`). Examples (write one per FK above, 17 total, in the matching `describe` block):

```ts
// describe('0001 identity_roles', ...)
it('guardians.parent_id ON DELETE CASCADE', () => {
  expect(s()).toMatch(/guardians[\s\S]*?parent_id\s+uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
});
it('guardians.student_id ON DELETE CASCADE', () => {
  expect(s()).toMatch(/guardians[\s\S]*?student_id\s+uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
});
it('users.parent_id remains WITHOUT cascade (not a guardians FK)', () => {
  // regression guard: the users.parent_id self-FK must NOT be cascaded
  expect(s()).toMatch(/parent_id\s+uuid\s+REFERENCES public\.users\(id\),/);
});
```
```ts
// describe('0002 classes_enrollments', ...)
it('classes.teacher_id ON DELETE CASCADE', () => {
  expect(s()).toMatch(/teacher_id\s+uuid\s+REFERENCES public\.users\(id\) ON DELETE CASCADE/);
});
it('enrollments.class_id ON DELETE CASCADE', () => {
  expect(s()).toMatch(/enrollments[\s\S]*?class_id\s+uuid\s+NOT NULL REFERENCES public\.classes\(id\) ON DELETE CASCADE/);
});
it('enrollments.student_id ON DELETE CASCADE', () => {
  expect(s()).toMatch(/enrollments[\s\S]*?student_id\s+uuid\s+NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
});
```
```ts
// describe('0003 lessons_quizzes', ...) — lessons.class_id, lessons.teacher_id, quizzes.lesson_id,
// quizzes.class_id, quizzes.teacher_id, quiz_attempts.quiz_id, quiz_attempts.student_id (7 tests, table-anchored)
it('quiz_attempts.quiz_id ON DELETE CASCADE', () => {
  expect(s()).toMatch(/quiz_attempts[\s\S]*?quiz_id\s+uuid\s+NOT NULL REFERENCES public\.quizzes\(id\) ON DELETE CASCADE/);
});
// ...and the other 6, each anchored to its table.
```
```ts
// describe('0004 assignments_homework', ...) — assignments.student_id/class_id/lesson_id,
// homework_attempts.assignment_id/student_id (5 tests, table-anchored)
it('homework_attempts.assignment_id ON DELETE CASCADE', () => {
  expect(s()).toMatch(/homework_attempts[\s\S]*?assignment_id\s+uuid NOT NULL REFERENCES public\.assignments\(id\) ON DELETE CASCADE/);
});
```

- [ ] **Step 2: Run; confirm the 17 new tests FAIL** (cascade not yet present); the `users.parent_id` regression-guard test should PASS already:
`npx vitest run supabase/migrations/__tests__/migrations.test.ts`

- [ ] **Step 3: Apply the 17 edits** exactly as listed above. CAUTION on `0001`: edit the two `guardians` FK lines (L65/L66), NOT the `users.parent_id` line (L50) and NOT the already-cascaded `users.school_id` (L42).

- [ ] **Step 4: Run; confirm ALL migration tests pass** (17 new + all existing):
`npx vitest run supabase/migrations/__tests__/migrations.test.ts`

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0001_identity_roles.sql supabase/migrations/0002_classes_enrollments.sql supabase/migrations/0003_lessons_quizzes.sql supabase/migrations/0004_assignments_homework.sql supabase/migrations/__tests__/migrations.test.ts
git commit -m "fix(migrations): complete school-child ON DELETE CASCADE graph (C4 — clean seeded-school teardown)"
```

---

## Task 2 — Residual low-severity lib fixes

**Files:**
- Edit: `src/lib/trial/seedTrialDemoData.ts`
- Edit: `src/lib/trial/ensureAuthUser.ts`
- Edit: `src/lib/trial/__tests__/ensureAuthUser.test.ts`

**Fix A — quiz step records exactly once (remove latent double-record).** Restructure Step 6 so the `quiz` step is recorded ONCE after the try/catch, driven by a `quizFailReason` flag, so a future `await` added inside the try can never cause both `recordOk('quiz')` and the catch's `recordSkip('quiz')` to fire:

```ts
// ── Step 6: Quiz + 5 quiz_questions (soft fail) ──────────────────────────────
let quizId: string | null = null;
if (classId && lessonId) {
  let qqFailCount = 0;
  let qqFirstError = '';
  let quizFailReason: string | null = null;
  try {
    quizId = randomUUID();
    const { error } = await admin.from('quizzes').insert({
      id: quizId, lesson_id: lessonId, class_id: classId, teacher_id: teacherId,
      title: rows.quiz.title, status: rows.quiz.status, published_at: now.toISOString(),
    });
    if (error) throw error;
    for (const q of rows.quiz_questions) {
      const { error: qErr } = await admin.from('quiz_questions').insert({
        quiz_id: quizId, position: q.position, question_type: q.question_type, question_text: q.question_text,
      });
      if (qErr) { qqFailCount++; if (!qqFirstError) qqFirstError = qErr.message; }
    }
  } catch (e) {
    quizId = null;
    quizFailReason = (e as Error).message;
  }
  if (quizFailReason) {
    recordSkip('quiz', quizFailReason);
  } else if (qqFailCount > 0) {
    recordSkip('quiz', `${qqFailCount}/${rows.quiz_questions.length} quiz_questions failed: ${qqFirstError}`);
  } else {
    recordOk('quiz');
  }
} else {
  recordSkip('quiz', `prerequisite ${!classId ? 'class' : 'lesson'} missing`);
}
```
(Behaviour is identical for all current inputs; this only removes the latent double-record trap. No new test required — existing seedTrialDemoData tests must still pass.)

**Fix B — wrap the C2 rollback `deleteUser` in try/catch** so a thrown SDK rejection can't mask the original `insErr` (`ensureAuthUser.ts`):
```ts
if (insErr) {
  // Best-effort rollback of the auth user we just created. Never let a rollback
  // failure (returned OR thrown) mask the original insert error.
  try {
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) console.error(`[ensureAuthUser] rollback deleteUser(${id}) failed:`, delErr.message);
  } catch (delEx) {
    console.error(`[ensureAuthUser] rollback deleteUser(${id}) threw:`, (delEx as Error).message);
  }
  throw insErr;
}
```

**Fix C — check the existing-row `update` `{error}`** (the `full_name` reconcile is best-effort; a failure is non-fatal — the user is already correctly bound — so LOG, do not throw) (`ensureAuthUser.ts`):
```ts
// existing-row branch — replace the bare update:
const { error: updErr } = await admin.from('users').update({ full_name }).eq('id', id);
if (updErr) console.error(`[ensureAuthUser] full_name reconcile failed for ${id} (non-fatal):`, updErr.message);
```

- [ ] **Step 1: Write the failing tests** (add to `ensureAuthUser.test.ts`):

```ts
it('rollback that THROWS does not mask the original insert error (C2 hardening)', async () => {
  const deleteUser = vi.fn(async () => { throw new Error('network down'); }); // rejects
  const fromMock = vi.fn(() => ({
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
    insert: vi.fn(async () => ({ error: { message: 'insert boom' } })),
    update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
  }));
  const admin = {
    auth: { admin: { createUser: vi.fn(async () => ({ data: { user: { id: 'new-1' } }, error: null })), listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })), deleteUser } },
    from: fromMock,
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  await expect(ensureAuthUser({ admin, email: 'n@s.com', password: 'pw', full_name: 'N', role: 'teacher', school_id: 'school-1' }))
    .rejects.toThrow(/insert boom/i); // NOT "network down"
  expect(deleteUser).toHaveBeenCalledWith('new-1');
});

it('existing-row full_name reconcile failure is non-fatal (returns the id, does not throw) (Fix C)', async () => {
  const fromMock = vi.fn(() => ({
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: 'existing-auth-id', role: 'teacher', school_id: 'school-1' }, error: null })) })) })),
    update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: { message: 'update boom' } })) })), // returns {error}
    insert: vi.fn(async () => ({ error: null })),
  }));
  const admin = {
    auth: { admin: { createUser: vi.fn(async () => ({ data: null, error: { message: 'User already registered' } })), listUsers: vi.fn(async () => ({ data: { users: [{ id: 'existing-auth-id', email: 'taken@school.com' }] }, error: null })), deleteUser: vi.fn(async () => ({ error: null })) } },
    from: fromMock,
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
  const id = await ensureAuthUser({ admin, email: 'taken@school.com', password: 'pw', full_name: 'Taken', role: 'teacher', school_id: 'school-1' });
  expect(id).toBe('existing-auth-id'); // resolves; the failed full_name update did not throw
});
```

- [ ] **Step 2: Run; confirm the two new tests FAIL** (currently the thrown rollback masks insErr; the unchecked update would still resolve — but verify the C2 test fails pre-fix):
`npx vitest run src/lib/trial/__tests__/ensureAuthUser.test.ts`

- [ ] **Step 3: Apply Fix A (seedTrialDemoData.ts), Fix B + Fix C (ensureAuthUser.ts)** as specified above.

- [ ] **Step 4: Run; confirm ALL pass** (new + existing ensureAuthUser + seedTrialDemoData tests):
`npx vitest run src/lib/trial/__tests__/ensureAuthUser.test.ts src/lib/trial/__tests__/seedTrialDemoData.test.ts`

- [ ] **Step 5: Commit**
```bash
git add src/lib/trial/seedTrialDemoData.ts src/lib/trial/ensureAuthUser.ts src/lib/trial/__tests__/ensureAuthUser.test.ts
git commit -m "fix(trial): quiz step records once + rollback try/catch + existing-row update {error} check (round-3 minors)"
```

---

## Task 3 — Verify whole branch

- [ ] `npx tsc --noEmit` → CLEAN.
- [ ] `npx vitest run src/lib/trial/__tests__/ supabase/migrations/__tests__/migrations.test.ts src/app/api/admin/provision-trial/__tests__/` → all pass.
- [ ] `npm run lint` → 0 errors.
- [ ] Proceed to final whole-branch review, then merge + push.

## Self-Review

- C4: 17 transitive school-child FKs now `ON DELETE CASCADE`; `users.parent_id` self-FK deliberately left (regression-guarded); `quiz_responses.question_id` / `assignments.quiz_attempt_id` left (deleted via their other cascade path). Static tests assert each, table-anchored. ✓
- Fix A: quiz recorded exactly once via `quizFailReason`; no behavior change for current inputs. ✓
- Fix B/C: rollback hardened against thrown rejection; existing-row update failure surfaced (logged) without throwing; guard logic untouched. ✓
- LIVE DB reconcile (round-1's 6 + round-3's 17 = 23 FKs) is a SEPARATE operational ALTER applied by the controller after merge (the live "NEW CORE" schema predates the inline edits), verified by re-querying `pg_constraint`. Not part of this plan's tests. ✓
