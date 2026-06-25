# Task 9 Report — Demo seed CL history + Barb copy drafts

**Status:** DONE  
**Commit:** `4d6c289`  
**Tests:** 1/1 passed (`scripts/__tests__/backfillSkillStateSnapshots.test.ts` — pure row-builder: 8 rows, 4 distinct dates, solid-state count climbs from earliest to latest week)  
**tsc:** 0 errors  

**Seed variable names confirmed (wired against):**
- `studentIds` — `Record<string, string>` (line 219 of seedDemo.ts) → `Object.values(studentIds)`
- `skillId` — `string | null` (line 336)
- `schoolId` — `string` (line 115)
- `classId` — `string | null` (line 255)
- `admin` — `SupabaseClient` (line 44)

Backfill call placed immediately after the `skill_learning_state` upsert block, guarded `if (skillId && classId)`. Import added at top of seedDemo.ts.

## Review fixes

**Commit:** `586ad41`

**Tests:**
- `npx vitest run src/lib/insights/__tests__/loadClassComprehension.test.ts` — 7 passed (7)
- `npx vitest run src/app/api/cron/weekly-snapshot` — 22 passed (22) across 2 files
- `npx tsc --noEmit` — 0 errors

**Banned word used in Fix-1 test:** `divergence` (skill name "Divergence drill")

**Changes:**
- FIX 1: `loadClassComprehension.ts` — imported `hasBannedWord` from `@/lib/copy/leakGuard`; added `if (hasBannedWord(sk.name)) continue;` after the `classSkillIdSet` scope check in the live-tally loop.
- FIX 2: `loadClassComprehension.test.ts` — added `makeAdminRecording` helper that captures `.in(col, vals)` calls per table; added 2 new tests: (a) banned-word skill excluded from tally, (b) DB `.in('skill_id', ['sk1'])` verified on both `skill_learning_state` and `skill_state_snapshots`.
- FIX 3: `skillStateSnapshots.test.ts` — added `upsertErrors` override map; extended `beforeEach` to reset it; added ordering-invariant test asserting that a `skill_state_snapshots` upsert error leaves `processed=1`, `failed=0`, and `student_model_snapshots` still written.

---

## Review fixes (prodops audit+license whole-branch review)

### FIX A — audit the Google import-roster wizard

**File changed:** `src/app/api/teacher/google/import-roster/route.ts`

Added `import { logAudit } from '@/lib/audit/logAudit'` and, immediately after the `reconcileCourseRoster` await and before the success return, wired the same change-guard and `logAudit` call that `/google/sync` uses. The only difference is `metadata.via: 'import'` to distinguish the first-import from a recurring sync.

**Test file changed:** `src/app/api/teacher/google/import-roster/__tests__/route.test.ts`

- Added `vi.mock('@/lib/audit/logAudit', ...)` + `logAudit` spy, reset in `beforeEach`.
- Added two new tests:
  - `'logs roster.sync with via:import when reconcile reports changes'` — default reconcile returns `enrolled:3` (satisfies the guard); asserts `logAudit` called once with `action:'roster.sync'`, `resourceType:'class'`, correct `resourceId`, and `metadata.via === 'import'`.
  - `'does NOT log when reconcile reports no changes (no-op import)'` — all counts zero; asserts `logAudit` not called.

### FIX B — strengthen the grade-override never-fatal test

**File changed:** `src/app/api/teacher/gradebook/override/__tests__/audit.test.ts`

- Extracted the `homework_attempts.update` stub into a named `attemptsUpdate` spy (reset in `beforeEach`) that records the patch argument while still returning `{ error: null }`.
- In the `'still returns 200 + writes the grade even if logAudit rejects (never-fatal)'` test, added two additional assertions after `expect(res.status).toBe(200)`:
  - `expect(attemptsUpdate).toHaveBeenCalledWith(expect.objectContaining({ teacher_score: 88 }))` — proves the DB write ran on the audit-failure path.
  - `expect(body.displayed_grade).toBe(88)` — proves the response carries the correct grade.

### Results

- Both affected suites: **17/17 tests passed**.
- `npx tsc --noEmit`: **0 errors**.
