# Chapter-Level Evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Port V1's chapter/unit-level evaluation system into V2 as a full 5-segment epic. Teachers group lessons into chapters, generate differentiated chapter tests (per-student, 5 sections, 44 min, 60 pts), students take the test in a new runner, and grades flow into the gradebook as first-class columns between assignments and diagnostic quizzes.

**Architecture:** Six new tables (migration 0030) + locked section templates ported from V1 → `generateChapterQuestions` engine (Claude per-student per-section) + teacher chapter management page + gradebook extended with chapter test columns + new student chapter test player + async `gradeChapterAttempt` pipeline via `after()`.

**Tech stack:** Next.js 16 route handlers, TypeScript strict, Vitest 4 (node for libs/routes; `// @vitest-environment jsdom` + `import '@/test/setup-dom'` for components), Supabase admin client (service-role, bypasses RLS).

**Spec:** `docs/superpowers/specs/2026-06-26-chapter-eval.md`.

---

## Global Constraints

- **Migration 0030** — 6 new tables + `ALTER TABLE lessons ADD COLUMN chapter_id`. All RLS deny-by-default (service_role FOR ALL policy only, no authenticated read/write policy). `GRANT ALL … TO authenticated, anon, service_role` on every new table (Bug #7). Re-runnable (IF NOT EXISTS + DROP POLICY IF EXISTS).
- **Admin client only** — all DB reads/writes use `createAdminSupabaseClient()`. RLS is NOT the IDOR backstop; `guardClassAccess`/`guardStudentAccess` is.
- **Auth chain** — `createServerSupabaseClient() → auth.getUser() → role gate (STAFF_ROLES or 'student') → guardClassAccess / guardStudentAccess → admin client`.
- **Claude model** — `claude-opus-4-8` for generation AND grading. Add `CLAUDE_CHAPTER_MODEL = process.env.ANTHROPIC_CHAPTER_MODEL || 'claude-opus-4-8'` to `src/lib/ai/models.ts`. **NEVER pass `temperature`** (400 on opus-4.x — CLAUDE.md GOTCHA). Use `resilientClaudeChat` from `src/lib/ai/claude.ts`.
- **Four-audience** — chapter tests are GRADED (summative). Students SEE `total_grade` after grading (same as homework). Per-section breakdown is TEACHER-ONLY. No band/risk/CL on any student-facing string.
- **`total_grade` (numeric)** — chapter tests produce a GRADE, not a score_pct. Follows the V1 score-vs-grade lock. Stored as `numeric(5,2)` on `chapter_test_attempts`.
- **Template locked** — 44 min / 60 pts / 5 sections verbatim. No customization UI.
- **`after()` pattern** — generation and grading both use Next.js `after()` (same as `quizzes/generate/route.ts` and `attempts/homework-submit`). Never throw out of `after()`.
- **Token-only styling**, `text-fg` deep-ink, no hardcoded hex/arbitrary values.
- **Vitest 4 TDD** — write failing tests FIRST, then implement.
- **Strings** → `STRINGS-FOR-BARB.md §Chapter Eval` for all user-facing copy.
- **Gates** — tsc 0 · vitest green · build 0 (a11y + tokens check). Migration 0030.

---

## File Structure

**New migrations:**
- `supabase/migrations/0030_chapter_eval.sql`

**New lib:**
- `src/lib/chapters/chapterTemplates.ts` — section structure constants (V1 port)
- `src/lib/chapters/generateChapterTest.ts` — `generateChapterQuestions` engine
- `src/lib/chapters/gradeChapterTest.ts` — `gradeChapterAttempt` pipeline

**Modified lib:**
- `src/lib/ai/models.ts` — add `CLAUDE_CHAPTER_MODEL`
- `src/lib/gradebook/loadGradebook.ts` — extend with `chapter_test_columns` + `chapter_test_cells`

**New routes:**
- `POST /api/teacher/chapters` + `GET /api/teacher/chapters`
- `PATCH /api/teacher/chapters/[chapterId]` + `DELETE /api/teacher/chapters/[chapterId]`
- `POST /api/teacher/chapters/[chapterId]/lessons` + `DELETE /api/teacher/chapters/[chapterId]/lessons/[lessonId]`
- `POST /api/teacher/chapter-tests` — create + queue generation
- `GET /api/teacher/chapter-tests/[chapterTestId]` — poll generation_status + section counts
- `PATCH /api/teacher/chapter-tests/[chapterTestId]` — publish / archive
- `GET /api/teacher/chapter-tests/[chapterTestId]/students/[studentId]` — per-student question preview
- `POST /api/attempts/chapter-test/start` — create/resume attempt
- `POST /api/attempts/chapter-test/save-response` — per-question autosave (idempotent)
- `POST /api/attempts/chapter-test/submit` — final submit → triggers grading
- `GET /api/attempts/chapter-test/[attemptId]` — poll status + result

**Modified routes:**
- `src/app/(teacher)/gradebook/page.tsx` — pass chapter test data
- `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx` — chapter test column group

**New pages:**
- `src/app/(teacher)/chapters/page.tsx` — chapter management
- `src/app/(student)/student/chapter-test/page.tsx` — chapter test player

**New components:**
- `src/app/(teacher)/chapters/_components/ChapterList.tsx`
- `src/app/(teacher)/chapters/_components/ChapterTestGenerator.tsx`
- `src/app/(teacher)/gradebook/_components/ChapterTestDrillIn.tsx`
- `src/app/(student)/student/chapter-test/_components/ChapterTestPlayer.tsx`
- `src/app/(student)/student/chapter-test/_components/ChapterTestTimer.tsx`
- `src/app/(student)/student/chapter-test/_components/SectionCard.tsx`
- `src/app/(student)/student/chapter-test/_components/QuestionRenderer.tsx`
- `src/app/(student)/student/chapter-test/_components/ChapterTestResultScreen.tsx`

**Dependency order (across all segments):**
`Seg1(T1→T7)` → `Seg2(T1→T7)` → `Seg3(T1→T5)` → `Seg4(T1→T7)` → `Seg5(T1→T6)`

Within each segment: models constant first, then lib, then routes, then components.

---

## Segment 1 — Schema + Chapter Management (teacher)

**Goal:** Migration 0030, template constants ported from V1, chapter CRUD, lesson-chapter assignment, teacher chapters page. No test generation yet.

**Dependency order:** T1 → T2 → T3 → T4 → T5 → T6 → T7

---

### Seg1 Task 1: `supabase/migrations/0030_chapter_eval.sql`

**Files:** Create `supabase/migrations/0030_chapter_eval.sql`

Key decisions carried from spec + V1:
- `chapters` is a first-class entity (D2), not derived from `lessons.chapter_title`
- `chapter_test_questions` has UNIQUE(section_id, student_id, question_order) — the load-bearing personalization constraint
- `chapter_test_attempts` has UNIQUE(chapter_test_id, student_id) — one attempt per (test, student)
- `chapter_test_responses` has UNIQUE(attempt_id, question_id)
- V1 migration also added `lessons.chapter_id` nullable FK — port this
- V1 also extended `concept_gaps` — **DEFER** the concept_gaps extension for this epic (no concept_gap integration needed in V2 pilot)
- All RLS: deny-by-default, service_role FOR ALL only. The admin client (service-role key) is the only writer.
- `total_grade numeric(5,2)` — NOT `score_pct`. Preserves the score-vs-grade lock.
- `generation_status` CHECK: `('draft','queued','generating','ready','failed')`
- `question_type` CHECK (spec §Data model): `('mcq','matching','short_answer','data_interpretation','mini_essay','multi_step_problem')` — use full names (not V1's shortened `data_interp`/`multi_step`)

- [ ] **Step 1:** Write `0030_chapter_eval.sql`. Full content:

```sql
-- supabase/migrations/0030_chapter_eval.sql
-- Chapter-Level Evaluation: 6 new tables + lessons.chapter_id.
-- All RLS deny-by-default (service_role FOR ALL). Admin client only.
-- See spec docs/superpowers/specs/2026-06-26-chapter-eval.md.
-- V1 reference: core/supabase/migrations/065_chapter_tests.sql.
-- NOTE: concept_gaps extension deferred (not needed for V2 pilot).

-- ── chapters ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  teacher_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  sequence    int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (class_id, title)
);
CREATE INDEX IF NOT EXISTS idx_chapters_class
  ON public.chapters(class_id, archived_at NULLS FIRST, sequence);
CREATE INDEX IF NOT EXISTS idx_chapters_teacher
  ON public.chapters(teacher_id);

-- ── lessons.chapter_id (nullable rollup) ────────────────────
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS chapter_id uuid REFERENCES public.chapters(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lessons_chapter
  ON public.lessons(chapter_id) WHERE chapter_id IS NOT NULL;

-- ── chapter_tests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_tests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id        uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  class_id          uuid NOT NULL REFERENCES public.classes(id),
  teacher_id        uuid NOT NULL REFERENCES public.users(id),
  title             text NOT NULL,
  template          text NOT NULL DEFAULT 'humanities'
    CHECK (template IN ('humanities','stem')),
  total_minutes     int  NOT NULL DEFAULT 44,
  total_points      int  NOT NULL DEFAULT 60,
  generation_status text NOT NULL DEFAULT 'draft'
    CHECK (generation_status IN ('draft','queued','generating','ready','failed')),
  status            text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  published_at      timestamptz,
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chapter_tests_chapter
  ON public.chapter_tests(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapter_tests_class
  ON public.chapter_tests(class_id, status);
CREATE INDEX IF NOT EXISTS idx_chapter_tests_inflight
  ON public.chapter_tests(generation_status)
  WHERE generation_status IN ('queued','generating');

-- ── chapter_test_sections ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_test_sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_test_id uuid NOT NULL REFERENCES public.chapter_tests(id) ON DELETE CASCADE,
  section_order   int  NOT NULL,
  section_kind    text NOT NULL
    CHECK (section_kind IN (
      'vocabulary','short_answer','compare_contrast',
      'data_interpretation','mini_essay','multi_step_problem'
    )),
  title           text NOT NULL,
  time_minutes    int  NOT NULL,
  total_points    int  NOT NULL,
  power_skill     text,
  UNIQUE (chapter_test_id, section_order)
);
CREATE INDEX IF NOT EXISTS idx_chapter_test_sections_test
  ON public.chapter_test_sections(chapter_test_id, section_order);

-- ── chapter_test_questions (per-student rows) ────────────────
CREATE TABLE IF NOT EXISTS public.chapter_test_questions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id         uuid NOT NULL REFERENCES public.chapter_test_sections(id) ON DELETE CASCADE,
  student_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  question_order     int  NOT NULL,
  question_type      text NOT NULL
    CHECK (question_type IN (
      'mcq','matching','short_answer','data_interpretation','mini_essay','multi_step_problem'
    )),
  question_text      text NOT NULL,
  payload            jsonb NOT NULL DEFAULT '{}',
  points             int  NOT NULL,
  comprehension_band text,
  learning_style     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, student_id, question_order)
);
CREATE INDEX IF NOT EXISTS idx_chapter_test_questions_section_student
  ON public.chapter_test_questions(section_id, student_id);
CREATE INDEX IF NOT EXISTS idx_chapter_test_questions_student
  ON public.chapter_test_questions(student_id);

-- ── chapter_test_attempts ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_test_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_test_id uuid NOT NULL REFERENCES public.chapter_tests(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at      timestamptz DEFAULT now(),
  submitted_at    timestamptz,
  last_active_at  timestamptz DEFAULT now(),
  status          text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','submitted','graded')),
  total_grade     numeric(5,2),
  total_max       int,
  forfeit_reason  text CHECK (forfeit_reason IS NULL OR forfeit_reason IN ('closure','time_up')),
  UNIQUE (chapter_test_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_chapter_test_attempts_test
  ON public.chapter_test_attempts(chapter_test_id, status);
CREATE INDEX IF NOT EXISTS idx_chapter_test_attempts_student
  ON public.chapter_test_attempts(student_id, submitted_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_chapter_test_attempts_inflight
  ON public.chapter_test_attempts(last_active_at)
  WHERE status = 'in_progress';

-- ── chapter_test_responses ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chapter_test_responses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id       uuid NOT NULL REFERENCES public.chapter_test_attempts(id) ON DELETE CASCADE,
  question_id      uuid NOT NULL REFERENCES public.chapter_test_questions(id),
  response_text    text,
  response_payload jsonb DEFAULT '{}',
  grade            numeric(5,2),
  ai_feedback      text,
  graded_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_chapter_test_responses_attempt
  ON public.chapter_test_responses(attempt_id);

-- ── RLS: deny-by-default, service_role FOR ALL ───────────────
ALTER TABLE public.chapters                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_tests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_test_sections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_test_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_test_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapter_test_responses  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chapters_service_role_all"              ON public.chapters;
DROP POLICY IF EXISTS "chapter_tests_service_role_all"         ON public.chapter_tests;
DROP POLICY IF EXISTS "chapter_test_sections_service_role_all" ON public.chapter_test_sections;
DROP POLICY IF EXISTS "chapter_test_questions_service_role_all" ON public.chapter_test_questions;
DROP POLICY IF EXISTS "chapter_test_attempts_service_role_all" ON public.chapter_test_attempts;
DROP POLICY IF EXISTS "chapter_test_responses_service_role_all" ON public.chapter_test_responses;

CREATE POLICY "chapters_service_role_all"
  ON public.chapters FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapter_tests_service_role_all"
  ON public.chapter_tests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapter_test_sections_service_role_all"
  ON public.chapter_test_sections FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapter_test_questions_service_role_all"
  ON public.chapter_test_questions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapter_test_attempts_service_role_all"
  ON public.chapter_test_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chapter_test_responses_service_role_all"
  ON public.chapter_test_responses FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Grants (Bug #7) ──────────────────────────────────────────
GRANT ALL ON public.chapters                TO authenticated, anon, service_role;
GRANT ALL ON public.chapter_tests           TO authenticated, anon, service_role;
GRANT ALL ON public.chapter_test_sections   TO authenticated, anon, service_role;
GRANT ALL ON public.chapter_test_questions  TO authenticated, anon, service_role;
GRANT ALL ON public.chapter_test_attempts   TO authenticated, anon, service_role;
GRANT ALL ON public.chapter_test_responses  TO authenticated, anon, service_role;
```

- [ ] **Step 2:** Verify: `chapter_test_questions` UNIQUE constraint is `(section_id, student_id, question_order)` — the personalization key. `chapter_test_attempts` UNIQUE is `(chapter_test_id, student_id)`. `total_grade` is `numeric(5,2)` (not `score_pct`). `generation_status` inflight index covers `queued` + `generating` (not `draft`). `lessons.chapter_id` uses ON DELETE SET NULL (lessons survive chapter delete).
- [ ] **Step 3:** Commit `feat(chapter-eval): migration 0030 — 6 tables + lessons.chapter_id`

---

### Seg1 Task 2: Migration test assertions

**Files:** Add `describe('0030 chapter_eval', ...)` block to `supabase/migrations/__tests__/migrations.test.ts`

- [ ] **Step 1:** Read `migrations.test.ts` lines 1–10 for the `sql()` helper pattern. Append:

```ts
describe('0030 chapter_eval', () => {
  const s = () => sql('0030_chapter_eval.sql');

  it('creates all 6 chapter tables', () => {
    for (const t of ['chapters','chapter_tests','chapter_test_sections','chapter_test_questions','chapter_test_attempts','chapter_test_responses']) {
      expect(s()).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`));
    }
  });

  it('adds lessons.chapter_id nullable with ON DELETE SET NULL', () => {
    expect(s()).toMatch(/ALTER TABLE public\.lessons\s+ADD COLUMN IF NOT EXISTS chapter_id\s+uuid/i);
    expect(s()).toMatch(/ON DELETE SET NULL/);
  });

  it('chapter_tests has generation_status + status CHECKs', () => {
    expect(s()).toMatch(/generation_status[^;]*CHECK[^;]*'queued'[^;]*'generating'[^;]*'ready'[^;]*'failed'/);
    expect(s()).toMatch(/status[^;]*CHECK[^;]*'draft'[^;]*'published'[^;]*'archived'/);
  });

  it('chapter_test_questions has the personalization UNIQUE(section_id, student_id, question_order)', () => {
    expect(s()).toMatch(/UNIQUE \(section_id, student_id, question_order\)/);
  });

  it('chapter_test_questions question_type CHECK uses full names (data_interpretation not data_interp)', () => {
    expect(s()).toMatch(/question_type[^;]*CHECK[^;]*'data_interpretation'/);
    expect(s()).not.toContain("'data_interp'");
    expect(s()).toMatch(/question_type[^;]*CHECK[^;]*'multi_step_problem'/);
    expect(s()).not.toContain("'multi_step'");
  });

  it('chapter_test_attempts has UNIQUE(chapter_test_id, student_id) + total_grade numeric(5,2)', () => {
    expect(s()).toMatch(/UNIQUE \(chapter_test_id, student_id\)/);
    expect(s()).toMatch(/total_grade\s+numeric\(5,2\)/);
  });

  it('chapter_test_attempts status CHECK includes all 4 lifecycle values', () => {
    for (const v of ['not_started','in_progress','submitted','graded']) {
      expect(s()).toContain(`'${v}'`);
    }
  });

  it('chapter_test_responses has UNIQUE(attempt_id, question_id)', () => {
    expect(s()).toMatch(/UNIQUE \(attempt_id, question_id\)/);
  });

  it('enables RLS on all 6 tables (deny-by-default)', () => {
    for (const t of ['chapters','chapter_tests','chapter_test_sections','chapter_test_questions','chapter_test_attempts','chapter_test_responses']) {
      expect(s()).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`));
    }
  });

  it('creates service_role_all policies (DROP-then-CREATE, re-runnable)', () => {
    expect(s()).toMatch(/DROP POLICY IF EXISTS/);
    for (const t of ['chapters','chapter_tests','chapter_test_sections','chapter_test_questions','chapter_test_attempts','chapter_test_responses']) {
      expect(s()).toMatch(new RegExp(`CREATE POLICY "${t}_service_role_all".*FOR ALL TO service_role`, 's'));
    }
  });

  it('grants ALL to authenticated, anon, service_role on all 6 tables (Bug #7)', () => {
    for (const t of ['chapters','chapter_tests','chapter_test_sections','chapter_test_questions','chapter_test_attempts','chapter_test_responses']) {
      expect(s()).toMatch(new RegExp(`GRANT ALL ON public\\.${t}\\s+TO authenticated, anon, service_role`));
    }
  });
});
```

- [ ] **Step 2:** Run `npx vitest run supabase/migrations/__tests__/migrations.test.ts` → should PASS (SQL from T1 satisfies all assertions).
- [ ] **Step 3:** Commit `test(chapter-eval): migration 0030 SQL assertions`

---

### Seg1 Task 3: `src/lib/chapters/chapterTemplates.ts` + tests

**Files:** Create `src/lib/chapters/chapterTemplates.ts`, `src/lib/chapters/__tests__/chapterTemplates.test.ts`

Port V1's `lib/teacher/chapterTestTemplates.ts` verbatim, adjusting:
- Import path change (no `isStemSubject` — define `ChapterTestTemplate` inline as `'humanities' | 'stem'`)
- Rename `SectionDefinition.kind` from `SectionKind` values to match spec's `section_kind` CHECK (already matching V1)
- `question_count` per section: vocabulary=6, short_answer=2, compare_contrast=1, data_interpretation=3, mini_essay=1, multi_step_problem=1
- Add export of `ChapterTestTemplate` type (was imported from `isStemSubject` in V1)

**Interfaces produced:**
```ts
export type ChapterTestTemplate = 'humanities' | 'stem';
export type SectionKind = 'vocabulary' | 'short_answer' | 'compare_contrast' | 'data_interpretation' | 'mini_essay' | 'multi_step_problem';
export type PowerSkill = 'foundational' | 'think' | 'research' | 'communicate';
export interface SectionDefinition { order: number; kind: SectionKind; title: string; time_minutes: number; total_points: number; power_skill: PowerSkill; question_count: number; }
export interface TemplateDefinition { template: ChapterTestTemplate; total_minutes: 44; total_points: 60; sections: ReadonlyArray<SectionDefinition>; }
export const HUMANITIES_TEMPLATE: TemplateDefinition;
export const STEM_TEMPLATE: TemplateDefinition;
export function getTemplate(template: ChapterTestTemplate): TemplateDefinition;
export function totalPoints(t: TemplateDefinition): number;
export function totalMinutes(t: TemplateDefinition): number;
```

- [ ] **Step 1:** Write the failing test `src/lib/chapters/__tests__/chapterTemplates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HUMANITIES_TEMPLATE, STEM_TEMPLATE, getTemplate, totalPoints, totalMinutes } from '@/lib/chapters/chapterTemplates';

describe('HUMANITIES_TEMPLATE', () => {
  it('has exactly 5 sections ordered 1-5', () => {
    expect(HUMANITIES_TEMPLATE.sections).toHaveLength(5);
    HUMANITIES_TEMPLATE.sections.forEach((s, i) => expect(s.order).toBe(i + 1));
  });
  it('total_minutes == 44 (sum of section time_minutes)', () => {
    expect(totalMinutes(HUMANITIES_TEMPLATE)).toBe(44);
  });
  it('total_points == 60 (sum of section total_points)', () => {
    expect(totalPoints(HUMANITIES_TEMPLATE)).toBe(60);
  });
  it('section 1 is vocabulary / foundational / 10pt / 8min / 6 questions', () => {
    const s = HUMANITIES_TEMPLATE.sections[0];
    expect(s.kind).toBe('vocabulary');
    expect(s.power_skill).toBe('foundational');
    expect(s.total_points).toBe(10);
    expect(s.time_minutes).toBe(8);
    expect(s.question_count).toBe(6);
  });
  it('section 5 is mini_essay / communicate / 10pt / 8min / 1 question', () => {
    const s = HUMANITIES_TEMPLATE.sections[4];
    expect(s.kind).toBe('mini_essay');
    expect(s.power_skill).toBe('communicate');
    expect(s.total_points).toBe(10);
    expect(s.question_count).toBe(1);
  });
});

describe('STEM_TEMPLATE', () => {
  it('sections 1-4 are identical to humanities (content shift only at gen time)', () => {
    for (let i = 0; i < 4; i++) {
      expect(STEM_TEMPLATE.sections[i]).toEqual(HUMANITIES_TEMPLATE.sections[i]);
    }
  });
  it('section 5 is multi_step_problem / think / 10pt / 8min / 1 question', () => {
    const s = STEM_TEMPLATE.sections[4];
    expect(s.kind).toBe('multi_step_problem');
    expect(s.power_skill).toBe('think');
    expect(s.total_points).toBe(10);
    expect(s.question_count).toBe(1);
  });
  it('total_minutes == 44 and total_points == 60', () => {
    expect(totalMinutes(STEM_TEMPLATE)).toBe(44);
    expect(totalPoints(STEM_TEMPLATE)).toBe(60);
  });
});

describe('getTemplate', () => {
  it('returns HUMANITIES_TEMPLATE for "humanities"', () => { expect(getTemplate('humanities')).toBe(HUMANITIES_TEMPLATE); });
  it('returns STEM_TEMPLATE for "stem"', () => { expect(getTemplate('stem')).toBe(STEM_TEMPLATE); });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `src/lib/chapters/chapterTemplates.ts` (port V1 verbatim, adjusted as above).
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): chapterTemplates.ts — locked 44min/60pt/5-section templates (V1 port)`

---

### Seg1 Task 4: `CLAUDE_CHAPTER_MODEL` constant

**Files:** Modify `src/lib/ai/models.ts`

- [ ] **Step 1:** Write failing test in `src/lib/ai/__tests__/models.test.ts`:
```ts
it('CLAUDE_CHAPTER_MODEL defaults to claude-opus-4-8', () => {
  expect(CLAUDE_CHAPTER_MODEL).toBe('claude-opus-4-8');
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add to `src/lib/ai/models.ts`:
```ts
/** Anthropic model for chapter test generation + grading. Never pass temperature (400 on opus-4.x). */
export const CLAUDE_CHAPTER_MODEL = process.env.ANTHROPIC_CHAPTER_MODEL || 'claude-opus-4-8';
```
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): CLAUDE_CHAPTER_MODEL constant (claude-opus-4-8, no temperature)`

---

### Seg1 Task 5: Chapter CRUD routes

**Files:**
- `src/app/api/teacher/chapters/route.ts` (GET list + POST create)
- `src/app/api/teacher/chapters/[chapterId]/route.ts` (PATCH update + DELETE archive)
- `src/app/api/teacher/chapters/__tests__/route.test.ts`

**Interfaces consumed by callers:**
```ts
// GET /api/teacher/chapters?classId=<id>
// Response: { chapters: ChapterRow[] }
// ChapterRow: { id, class_id, title, description, sequence, created_at, archived_at, lesson_count: number }

// POST /api/teacher/chapters
// Body: { classId, title, description?, sequence? }
// Response: { chapter_id }

// PATCH /api/teacher/chapters/[chapterId]
// Body: { title?, description?, sequence?, archived?: boolean }
// Response: { ok: true }

// DELETE /api/teacher/chapters/[chapterId]  (soft-deletes: sets archived_at)
// Response: { ok: true }
```

Auth chain: `createServerSupabaseClient → auth.getUser() → STAFF_ROLES → guardClassAccess(classId) → admin client`. Read `src/app/api/teacher/google/publish/route.ts` for the exact prologue pattern.

- [ ] **Step 1:** Write failing tests — 401/403 cases; create chapter scoped to class; list returns only non-archived for that class; PATCH updates title + reorders sequence; DELETE sets archived_at (soft delete); cannot modify chapters of another teacher's class (IDOR guard via guardClassAccess).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement both route files. The admin client reads `chapters` by `class_id` only; `guardClassAccess` is the IDOR backstop (verify the chapter's `class_id` belongs to the caller before any write). GET query: `admin.from('chapters').select('id, class_id, title, description, sequence, created_at, archived_at').eq('class_id', classId).is('archived_at', null).order('sequence')`.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): chapter CRUD routes (create/list/update/archive)`

---

### Seg1 Task 6: Lesson-chapter assignment routes

**Files:**
- `src/app/api/teacher/chapters/[chapterId]/lessons/route.ts` (POST assign lessons)
- `src/app/api/teacher/chapters/[chapterId]/lessons/[lessonId]/route.ts` (DELETE unassign)
- Tests alongside

> **C1 — Lesson scope guard:** When assigning a lesson to a chapter, verify `lesson.class_id` matches the chapter's `class_id` BEFORE writing `chapter_id`. A teacher must not be able to assign another class's lesson to their chapter (IDOR).

- [ ] **Step 1:** Write failing tests — assign lesson sets `lessons.chapter_id`; unassign sets it to null; assigning a lesson from a different class returns 403; assigning to an archived chapter returns 409.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. POST body: `{ lessonIds: string[] }`. Load the chapter's `class_id` via admin, then verify each `lesson.class_id` matches before `admin.from('lessons').update({ chapter_id: chapterId }).in('id', validLessonIds)`. DELETE sets `chapter_id = null`.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): lesson-chapter assignment routes`

---

### Seg1 Task 7: Teacher chapters page + sidebar nav

**Files:**
- `src/app/(teacher)/chapters/page.tsx` — server component
- `src/app/(teacher)/chapters/_components/ChapterList.tsx` — client component
- Modify teacher sidebar to add "Chapters" nav link (read `TeacherSidebar` or `SidebarNav` in `src/app/(teacher)/_components/`)

**Page server component** (`page.tsx`):
- `requireRole(STAFF_ROLES)` → `userId`, class from `?class=`
- Load chapters for the class via admin (list route data shape)
- Load lessons for the class (with `chapter_id`) via admin — so ChapterList can show which lessons are assigned
- Pass to `ChapterList`

**`ChapterList` client component:**
- Accordion: each chapter expands to show its assigned lessons + a lesson-picker checkbox list
- "Add chapter" inline form (title + description)
- Drag-free reordering: up/down buttons (full drag-drop deferred)
- "Archive chapter" soft-delete with confirmation
- Each chapter row shows: title, sequence, assigned lesson count, "Create Test" CTA (links to ChapterTestGenerator in Seg 2)
- Token-only styling; strings → `STRINGS-FOR-BARB.md §Chapter Eval`

- [ ] **Step 1:** Write jsdom tests (`// @vitest-environment jsdom` + `import '@/test/setup-dom'`): render with 2 chapters, expand → shows lessons; "Add chapter" form POSTs to the route; "Archive" sends DELETE.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Read `src/app/(teacher)/library/lessons/_components/LessonLibrary.tsx` for Lesson Library styling conventions. Read sidebar component for nav pattern.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): teacher chapters page + ChapterList + sidebar nav`

---

## Segment 2 — Chapter Test Creation + Generation

**Goal:** `generateChapterQuestions` engine (Claude per-student per-section), chapter test CRUD routes, teacher polls generation status, teacher can preview per-student questions. No student player yet.

**Dependency order:** T1 → T2 → T3 → T4 → T5 → T6 → T7

---

### Seg2 Task 1: `src/lib/chapters/generateChapterTest.ts`

**Files:** Create `src/lib/chapters/generateChapterTest.ts`, `src/lib/chapters/__tests__/generateChapterTest.test.ts`

**Interfaces:**
```ts
export interface StudentContext {
  studentId: string;
  comprehension_band: string | null;   // snapshot at gen time
  learning_style: string | null;       // snapshot at gen time
}

export interface GenerateChapterQuestionsArgs {
  admin: SupabaseClient;
  chapterTestId: string;
  students: StudentContext[];
  lessonTexts: string[];   // parsed_content of all lessons in the chapter, joined
  template: ChapterTestTemplate;
}

export async function generateChapterQuestions(args: GenerateChapterQuestionsArgs): Promise<void>
```

**Algorithm:**
1. Update `chapter_tests.generation_status = 'generating'`
2. Load section rows for `chapterTestId` (ordered by `section_order`)
3. For each student in `students`:
   a. For each section: build Claude prompt → `resilientClaudeChat` → parse JSON → insert `chapter_test_questions` rows
   b. Snapshot `comprehension_band` + `learning_style` on each row
4. On all students complete: update `generation_status = 'ready'`
5. On ANY unrecoverable failure: update `generation_status = 'failed'`
6. Never throw — caller is `after()`

**Claude prompt strategy (per section per student):**
- System: "You are generating a chapter test for a [grade level] student. Return valid JSON only."
- User: section kind, section title, time limit, total points, question count, student's comprehension band + learning style, lesson texts
- Response schema: `{ questions: Array<{ question_order, question_type, question_text, payload, points }> }`
- Temperature: **omitted** (CLAUDE_CHAPTER_MODEL is opus-4.x — temperature causes 400)
- max_tokens: 2000 per section call

**Payload shapes per question_type (mirrors V1 065 migration comment):**
- `mcq`: `{ choices: [{label, text}], correct_answer: string, rationale: string }`
- `matching`: `{ left: string[], right: string[], pairs: [{left_idx, right_idx}] }`
- `short_answer`: `{ rubric: string, expected_signals: string[] }`
- `data_interpretation`: `{ mermaid?: string, prompt: string, rubric: string }` (V2 uses mermaid text, not image URLs)
- `mini_essay`: `{ rubric: string, claim_evidence_explanation_required: true }`
- `multi_step_problem`: `{ setup: string, work_steps_required: boolean, verification_required: boolean, rubric: string }`

**Points per section (from template):** Distribute evenly across question_count. Section 1 (vocabulary, 6 questions, 10 pts): matching questions get 1pt each, use-in-context gets 5pt. For simplicity in V2: divide `section.total_points` evenly, rounding last question up if needed.

> **C1 — Idempotency:** Before inserting questions for a (section_id, student_id) pair, check if rows already exist. If generation was interrupted and restarted, skip students who already have questions (ON CONFLICT DO NOTHING or pre-check). The UNIQUE constraint prevents duplicates; use `onConflict: 'ignore'` or check counts first.

- [ ] **Step 1:** Write failing tests — mocks `resilientClaudeChat` returning valid JSON for each section; asserts question rows are inserted with correct `section_id + student_id + question_order`; asserts `generation_status` transitions from `queued → generating → ready`; asserts `generation_status = 'failed'` when Claude throws `LlmExhaustedError`; asserts idempotency (running twice doesn't duplicate rows).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Use `resilientClaudeChat` from `src/lib/ai/claude.ts`. Do NOT pass `temperature`. Catch `LlmExhaustedError` from `src/lib/ai/errors.ts`. Process students serially (not Promise.all) to avoid overwhelming the API at pilot scale. Each section call: build prompt → `resilientClaudeChat` → `JSON.parse` the content → validate shape → insert rows.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): generateChapterQuestions engine (Claude per-student per-section, no temperature, fail-soft)`

---

### Seg2 Task 2: `POST /api/teacher/chapter-tests` — create + queue generation

**Files:** Create `src/app/api/teacher/chapter-tests/route.ts`, `__tests__/route.test.ts`

**Body:** `{ chapterId, title, template: 'humanities' | 'stem' }`

**What it does:**
1. Auth: STAFF_ROLES + `guardClassAccess(chapter.class_id)`
2. Create `chapter_tests` row (status='draft', generation_status='queued')
3. Insert 5 `chapter_test_sections` rows from `getTemplate(template).sections`
4. Return `{ chapter_test_id }` immediately (202 or 200)
5. `after()`: load enrolled students (with their comprehension_band + learning_style from `behavioral_signals.computed`), load lesson texts for the chapter, call `generateChapterQuestions`

> **C2 — student signals fetch inside `after()`:** Read each student's `behavioral_signals.computed` to get `comprehension_band` + `learning_style`. If a student has no row yet, fall back to `comprehension_band = null` (the generator treats null as grade_level). This is a best-effort snapshot — the band at generation time is preserved on the question row.

- [ ] **Step 1:** Write failing tests — 401/403/404; create inserts chapter_tests + 5 sections; returns `{ chapter_test_id }` immediately; `after()` content tested via unit test of generateChapterQuestions (integration tested in Seg2 T1).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Read `quizzes/generate/route.ts` for the after() pattern. Snapshot all data needed inside `after()` before the response is sent (admin client, chapterTestId, classId, lessonTexts, students array). Template sections: `getTemplate(template).sections.map(s => ({ chapter_test_id: chapterTestId, section_order: s.order, section_kind: s.kind, title: s.title, time_minutes: s.time_minutes, total_points: s.total_points, power_skill: s.power_skill }))`. On after() failure: update `generation_status = 'failed'` + log — never throw.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): POST /api/teacher/chapter-tests (create + queue generation via after())`

---

### Seg2 Task 3: `GET /api/teacher/chapter-tests/[chapterTestId]` — poll generation status

**Files:** `src/app/api/teacher/chapter-tests/[chapterTestId]/route.ts`, test alongside

**Response:** `{ generation_status, status, total_minutes, total_points, sections: Array<{ section_order, section_kind, title, question_counts: { total: number, [studentId]: number } }> }`

The teacher UI polls every 3s while `generation_status` is `queued` or `generating`. `section_counts` lets the teacher see per-section progress (how many students have questions generated for each section). Only show per-student counts to the teacher (teacher-only surface).

- [ ] **Step 1:** Write failing tests — 401/403/404; returns generation_status; section_counts counts question rows grouped by section.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Auth: STAFF_ROLES + guardClassAccess via `chapter_tests.class_id`. Load sections + question counts per section from admin client.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): GET /api/teacher/chapter-tests/[id] (poll generation_status + section counts)`

---

### Seg2 Task 4: `PATCH /api/teacher/chapter-tests/[chapterTestId]` — publish / archive

**Files:** Add to `src/app/api/teacher/chapter-tests/[chapterTestId]/route.ts`, tests alongside

**Body:** `{ action: 'publish' | 'archive' }`

**Guards:**
- Publish: `generation_status` must be `'ready'` (409 otherwise — "Test is still generating")
- Publish: must be `status = 'draft'` (409 if already published)
- Publish: every enrolled student must have at least 1 question in every section (409 otherwise — "Not all students have questions")
- Archive: sets `archived_at = now()`, `status = 'archived'`

- [ ] **Step 1:** Write failing tests — 409 on publish-when-not-ready; 409 on publish-when-student-has-no-questions; publish sets status='published' + published_at; archive sets archived_at.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement PATCH handler (add to existing route file or create separate). The "all students have questions" check: query `chapter_test_questions` grouped by section_id, compare to enrolled student count. Fast query: `SELECT COUNT(DISTINCT student_id), section_id FROM chapter_test_questions WHERE section_id IN (...) GROUP BY section_id` — if any section count < enrolled_count, 409.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): PATCH /api/teacher/chapter-tests/[id] (publish + archive, guards: ready + all-students-have-questions)`

---

### Seg2 Task 5: `GET /api/teacher/chapter-tests/[chapterTestId]/students/[studentId]` — per-student preview

**Files:** `src/app/api/teacher/chapter-tests/[chapterTestId]/students/[studentId]/route.ts`, test alongside

**Response:** `{ sections: Array<{ section_order, section_kind, title, questions: Array<{ id, question_order, question_type, question_text, payload, points }> }> }`

This is the teacher preview surface — a teacher can inspect any student's question set. Auth: STAFF_ROLES + guardClassAccess.

- [ ] **Step 1:** Write failing test — returns questions grouped by section for the given student; 404 if no questions (generation not complete); 403 if teacher doesn't own the class.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Load sections + questions WHERE `student_id = studentId` and `section_id IN (sections for this chapterTestId)`. Returns an empty `sections` array (not 404) if questions haven't been generated yet for that student.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): GET /api/teacher/chapter-tests/[id]/students/[studentId] (per-student question preview)`

---

### Seg2 Task 6: `ChapterTestGenerator.tsx` component

**Files:** Create `src/app/(teacher)/chapters/_components/ChapterTestGenerator.tsx`, `__tests__/ChapterTestGenerator.test.tsx`

**Behavior:**
- "Create Chapter Test" button → inline form: test title (pre-filled from chapter title), template selector (Humanities / STEM), submit
- On submit: POST `/api/teacher/chapter-tests` → shows a progress poller
- Poller: polls `GET /api/teacher/chapter-tests/[id]` every 3s while `generation_status` is `queued` or `generating`
- Progress display: per-section "Building…" / "Section N ready (X/Y students)" using question_counts
- On `ready`: "Preview questions" dropdown (per student) + "Publish" button (calls PATCH)
- On `failed`: "Try again" button (re-triggers generate route)
- On `published`: shows "✓ Published" badge + test title; no further editing

```ts
// @vitest-environment jsdom
import '@/test/setup-dom';
```

- [ ] **Step 1:** Write failing jsdom tests — renders create form; on submit shows loading; polling updates section counts; on ready shows preview + publish; on published shows badge; on failed shows retry.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Use `setInterval` for polling (clear on unmount). Template selector shows "Humanities" / "STEM" — defaults to humanities. Token-only styling.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): ChapterTestGenerator — create, poll generation, preview, publish`

---

### Seg2 Task 7: Wire ChapterTestGenerator into chapters page

**Files:** Modify `src/app/(teacher)/chapters/page.tsx` + `ChapterList.tsx`

- Load existing `chapter_tests` for each chapter (status + generation_status) via admin in the server component
- Pass to `ChapterList` so each chapter row knows its current test state
- `ChapterList` renders `ChapterTestGenerator` inside each chapter accordion when expanded

- [ ] **Step 1:** Modify `page.tsx` to load `chapter_tests` per chapter (join via `chapter_id`). Pass to `ChapterList` as `chapterTests: Record<chapterId, ChapterTestRow>`.
- [ ] **Step 2:** Modify `ChapterList` to show `ChapterTestGenerator` inside each expanded chapter.
- [ ] **Step 3:** Run tests → PASS + tsc 0.
- [ ] **Step 4:** Commit `feat(chapter-eval): wire ChapterTestGenerator into chapters page`

---

## Segment 3 — Gradebook Extension

**Goal:** Extend `loadGradebook` and `GradebookGrid` to show chapter test columns (after assignments, before diagnostic quizzes). Drill-in shows total_grade + per-section breakdown.

**Dependency order:** T1 → T2 → T3 → T4 → T5

---

### Seg3 Task 1: Extend `Gradebook` types + `loadGradebook` queries

**Files:** Modify `src/lib/gradebook/loadGradebook.ts`

**New types:**
```ts
export interface ChapterTestCol {
  chapter_test_id: string;
  chapter_title: string;    // chapters.title — the chapter's name
  test_title: string;       // chapter_tests.title
  published_at: string | null;
  total_points: number;     // always 60
}

export type ChapterTestCellStatus = 'not_started' | 'in_progress' | 'submitted' | 'graded';

export interface ChapterTestCell {
  attempt_id: string | null;
  status: ChapterTestCellStatus;
  total_grade: number | null;   // summative grade (not score_pct)
  total_max: number | null;     // always 60 when set
}

// Extend Gradebook:
export interface Gradebook {
  // ... existing fields ...
  chapter_test_columns: ChapterTestCol[];
  chapter_test_cells: Record<string, Record<string, ChapterTestCell>>; // [studentId][chapter_test_id]
}
```

**New queries (add after quiz query, before return):**
- Query 6: `chapter_tests` for class (status='published', not archived), joined to `chapters` for title, ordered by `published_at ASC`
- Query 7: `chapter_test_attempts` for those test IDs + enrolled student IDs (select `id, chapter_test_id, student_id, status, total_grade, total_max`)

Build `chapter_test_cells`: for each (student, chapter_test_col): find the attempt matching `(chapter_test_id, student_id)`. Map attempt status directly (not_started if no row). All enrolled students should see every published chapter test column (unlike assignment columns which can be 'none' for never-assigned students).

`MAX_CHAPTER_COLS = 8` constant (enough for a full year of unit tests; soft cap with console.warn like assignment cap).

- [ ] **Step 1:** Write failing tests in `src/lib/gradebook/__tests__/loadGradebook.test.ts` (or a new chapter-specific test file):
  - Returns `chapter_test_columns: []` when no published tests
  - Returns one column per published test, ordered by published_at
  - Cell status 'not_started' for a student with no attempt
  - Cell status 'graded' + total_grade for a graded attempt
  - Cell status 'submitted' for a submitted attempt
  - Column title uses chapter title + test title
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Add two new queries inside `loadGradebook`. The join for chapter titles: `admin.from('chapter_tests').select('id, title, published_at, total_points, chapters:chapter_id(title)').eq('class_id', classId).eq('status', 'published').is('archived_at', null).order('published_at')`.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): extend loadGradebook with chapter_test_columns + chapter_test_cells`

---

### Seg3 Task 2: Chapter test drill-in data route

**Files:** Create `src/app/api/teacher/gradebook/chapter-attempt/route.ts`, test alongside

**`GET /api/teacher/gradebook/chapter-attempt?chapterTestId=<id>&studentId=<id>`**

Response:
```ts
{
  attempt_id: string | null;
  status: ChapterTestCellStatus;
  total_grade: number | null;
  total_max: number | null;
  sections: Array<{
    section_order: number;
    section_kind: string;
    title: string;
    time_minutes: number;
    total_points: number;
    questions: Array<{
      question_order: number;
      question_type: string;
      question_text: string;
      points: number;
      response_text: string | null;
      response_payload: Record<string, unknown> | null;
      grade: number | null;
      ai_feedback: string | null;
    }>;
  }>;
}
```

Auth: STAFF_ROLES + `guardClassAccess` via `chapter_tests.class_id`.

This is an on-demand lazy load (gradebook stays light; only fetches when teacher clicks a cell).

- [ ] **Step 1:** Write failing tests — 401/403/404; returns sections with question-level responses + grades; returns null attempt data if student never started.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Load: chapter_test → sections → questions for this student → attempt → responses. Join responses to questions by question_id.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): GET /api/teacher/gradebook/chapter-attempt (per-student section+response drill-in)`

---

### Seg3 Task 3: `ChapterTestDrillIn.tsx` component

**Files:** Create `src/app/(teacher)/gradebook/_components/ChapterTestDrillIn.tsx`, `__tests__/ChapterTestDrillIn.test.tsx`

**Props:**
```ts
export interface ChapterTestDrillInProps {
  chapterTestId: string;
  chapterTitle: string;
  testTitle: string;
  studentId: string;
  studentName: string;
  classId: string;
  cell: ChapterTestCell;
  onClose: () => void;
}
```

**Behavior:**
- On mount: fetches `GET /api/teacher/gradebook/chapter-attempt?chapterTestId=...&studentId=...`
- Shows: test title, student name, status badge, `total_grade / total_max` (e.g. "47 / 60") — teacher surface, raw numbers allowed
- Per-section collapsible rows: section title, section grade (sum of question grades in that section), expand → per-question text answer + grade + AI feedback
- WCAG: focus trapped in panel, Escape closes, overlay backdrop
- Token-only styling; no hardcoded hex
- `// @vitest-environment jsdom`

- [ ] **Step 1:** Write failing jsdom tests — renders loading state; shows total_grade/total_max after fetch; per-section collapse; Escape closes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Read `GradebookDrillIn.tsx` for the panel layout + trap-focus + Escape pattern. Copy the focus-trap + backdrop structure. Per-section grade: sum `question.grade` within that section's questions.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): ChapterTestDrillIn — per-student section + response breakdown`

---

### Seg3 Task 4: Extend `GradebookGrid` for chapter test columns

**Files:** Modify `src/app/(teacher)/gradebook/_components/GradebookGrid.tsx`, `__tests__/GradebookGrid.test.tsx`

**Changes to GradebookGrid:**
1. Accept the extended `Gradebook` type (which now includes `chapter_test_columns` + `chapter_test_cells`)
2. After the assignment columns and before the DiagnosticChecksSection (which is rendered outside the grid on the page), add a visually separated group of chapter test columns IN the same table — separated by a sticky `<th>` spanning the group with label "Chapter Tests" (a `SectionLabel tone="ok"`)
3. Chapter test cell render:
   - Status glyph: `✓` (graded) / `⋯` (submitted) / `·` (not started or in_progress)
   - For graded cells: show `total_grade/total_max` (e.g., "47/60") — teacher surface, numbers allowed
   - No `score_pct` shown (chapter tests use `total_grade`, not percentage)
   - Click on graded/submitted cell → opens `ChapterTestDrillIn`
   - Not-started cells are inert (no click)
4. Chapter test columns are NOT included in the class average footer (average only over assignment columns, same as today)
5. Chapter test column header: chapter title (small) + test title (SectionLabel)

```ts
// New state needed in GradebookGrid:
const [chapterDrillIn, setChapterDrillIn] = useState<ChapterDrillInSelection | null>(null);

interface ChapterDrillInSelection {
  chapterTestId: string;
  chapterTitle: string;
  testTitle: string;
  studentId: string;
  studentName: string;
  classId: string;
  cell: ChapterTestCell;
}
```

- [ ] **Step 1:** Read the current `GradebookGrid.tsx` fully. Write failing jsdom tests: chapter test columns render after assignment columns; graded cell shows `47/60`; click graded cell opens ChapterTestDrillIn; not-started cell is inert.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Add the chapter test columns group after the last assignment `<th>` in the header row. In `<tbody>`, add chapter test `<td>` cells for each student after assignment cells. TONE: `bg-ok-surface` for graded, `bg-brand-surface` for submitted, `bg-surface` for not_started/in_progress. Render `ChapterTestDrillIn` at the bottom of the component (alongside `GradebookDrillIn`).
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): GradebookGrid chapter test columns (after assignments, before diagnostics)`

---

### Seg3 Task 5: Update gradebook page to thread chapter test data

**Files:** Modify `src/app/(teacher)/gradebook/page.tsx` (if needed)

Since `loadGradebook` now returns `chapter_test_columns` + `chapter_test_cells` as part of the `Gradebook` type, and `GradebookGrid` receives the full `Gradebook`, the page may require no changes. Verify by reading `page.tsx` and confirming it passes `gradebook` to `GradebookGrid` without destructuring. If it already passes the whole object, the page is done. If it spreads individual fields, add the new fields.

- [ ] **Step 1:** Read `src/app/(teacher)/gradebook/page.tsx`.
- [ ] **Step 2:** Verify or update prop threading. No new DB calls needed on the page since `loadGradebook` handles it.
- [ ] **Step 3:** Run `npm run build` → 0 errors.
- [ ] **Step 4:** Commit `feat(chapter-eval): gradebook page threads chapter test columns through Gradebook prop`

---

## Segment 4 — Student Chapter Test Player

**Goal:** `/student/chapter-test?chapterTestId=` player — start/resume, 5 section nav, per-question autosave, wall-clock timer (44 min hard), submit → triggers async grading.

**Dependency order:** T1 → T2 → T3 → T4 → T5 → T6 → T7

---

### Seg4 Task 1: `POST /api/attempts/chapter-test/start`

**Files:** `src/app/api/attempts/chapter-test/start/route.ts`, test alongside

**Body:** `{ chapterTestId: string }`

**Response (success):**
```ts
{
  attempt_id: string;
  status: 'not_started' | 'in_progress';
  started_at: string;
  elapsed_seconds: number;  // seconds since started_at
  sections: Array<{
    id: string;
    section_order: number;
    section_kind: string;
    title: string;
    time_minutes: number;
    total_points: number;
    power_skill: string;
    questions: Array<{
      id: string;
      question_order: number;
      question_type: string;
      question_text: string;
      payload: Record<string, unknown>;
      points: number;
    }>;
  }>;
  existing_responses: Array<{
    question_id: string;
    response_text: string | null;
    response_payload: Record<string, unknown>;
  }>;
}
```

**Behavior:**
- Auth: `requireRole(['student'])` or `getUser()` + role check for 'student'
- Verify: chapter test is `status='published'` + student is enrolled in `chapter_tests.class_id` (via `enrollments` table)
- Verify: `generation_status='ready'` (student has questions — 409 if not)
- Upsert attempt: `INSERT INTO chapter_test_attempts ... ON CONFLICT (chapter_test_id, student_id) DO UPDATE SET last_active_at=now(), status=CASE WHEN status='not_started' THEN 'in_progress' ELSE status END`
- Auto-forfeit: if `status='in_progress'` AND `elapsed_seconds >= 44*60`, set `status='submitted', submitted_at=now(), forfeit_reason='time_up'` → return `{ forfeited: true, attempt_id }` (player will show the result screen or a forfeit message)
- Returns all sections + this student's questions + existing responses (for resuming)
- Return 404 if no questions for this student (generation incomplete)

- [ ] **Step 1:** Write failing tests — 401 no auth; 403 non-student; 404 chapter test not found / not published; 403 student not enrolled; 409 generation not ready; idempotent create (UNIQUE constraint → resume); returns sections + questions + existing_responses; auto-forfeit if elapsed >= 44 min.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Use `createServerSupabaseClient → getUser` + check `role = 'student'`. Load chapter test → verify enrollment → load sections + questions (admin client, filter by `student_id = userId`). Load existing responses for the attempt. Use ON CONFLICT upsert for the attempt row.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): POST /api/attempts/chapter-test/start (create/resume + auto-forfeit + returns questions)`

---

### Seg4 Task 2: `POST /api/attempts/chapter-test/save-response`

**Files:** `src/app/api/attempts/chapter-test/save-response/route.ts`, test alongside

**Body:** `{ attemptId: string; questionId: string; response_text?: string; response_payload?: Record<string, unknown> }`

**Behavior:**
- Auth: `getUser()` + verify `chapter_test_attempts.student_id = userId` (IDOR guard)
- Verify attempt is `status = 'in_progress'` (not submitted/graded — 409 otherwise)
- Upsert `chapter_test_responses` (UNIQUE(attempt_id, question_id) — idempotent)
- Update `chapter_test_attempts.last_active_at = now()`
- Returns `{ ok: true }`

- [ ] **Step 1:** Write failing tests — 401; 403 wrong student; 409 if submitted; idempotent upsert; updates last_active_at.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `admin.from('chapter_test_responses').upsert({ attempt_id: attemptId, question_id: questionId, response_text, response_payload }, { onConflict: 'attempt_id,question_id' })`.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): POST /api/attempts/chapter-test/save-response (idempotent upsert, updates last_active_at)`

---

### Seg4 Task 3: `POST /api/attempts/chapter-test/submit`

**Files:** `src/app/api/attempts/chapter-test/submit/route.ts`, test alongside

**Body:** `{ attemptId: string; forfeit_reason?: 'time_up' | 'closure' | null }`

**Behavior:**
- Auth: `getUser()` + verify `student_id = userId`
- Guard: attempt `status` must be `'in_progress'` (409 if already submitted/graded — idempotent safe)
- Update: `status = 'submitted', submitted_at = now(), forfeit_reason = body.forfeit_reason ?? null`
- Trigger: `after(() => { gradeChapterAttempt(attemptId, admin) })` — async grading
- Return `{ ok: true, attempt_id: attemptId }`

> **C3 — Forfeit is still graded:** A forfeited attempt (time_up or closure) is still graded by `gradeChapterAttempt` with whatever responses were submitted. Missing responses get grade=0. The student sees their grade after grading completes.

- [ ] **Step 1:** Write failing tests — 401; 403 wrong student; 409 double-submit; sets status='submitted' + submitted_at; passes forfeit_reason; triggers grading (mock after()).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Read `attempts/homework-submit/route.ts` for the `after()` + grading pattern. Import `gradeChapterAttempt` from Seg5 lib (stub function for now — will be filled in Seg5).
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): POST /api/attempts/chapter-test/submit (forfeit support, triggers gradeChapterAttempt via after())`

---

### Seg4 Task 4: `GET /api/attempts/chapter-test/[attemptId]` — result polling

**Files:** `src/app/api/attempts/chapter-test/[attemptId]/route.ts`, test alongside

**Response (for result screen polling):**
```ts
{
  status: 'submitted' | 'graded';
  total_grade: number | null;
  total_max: number | null;
  forfeit_reason: string | null;
  sections: Array<{
    section_order: number;
    title: string;
    section_grade: number | null;  // sum of question grades in section
    section_max: number;           // section.total_points
    // Individual question feedback for the student
    questions: Array<{
      question_order: number;
      question_type: string;
      question_text: string;
      points: number;
      grade: number | null;
      ai_feedback: string | null;
      response_text: string | null;
    }>;
  }>;
}
```

Auth: `getUser()` + verify `student_id = userId`.

> **Four-audience:** This response is STUDENT-FACING. Return `total_grade` (allowed — summative). Do NOT return band/CL/risk. The `ai_feedback` per question is educational feedback, not a diagnostic label. `section_grade` shown as raw number is appropriate (it IS their grade). Surrounding prose must be checked with `hasLeak` before render in the component.

- [ ] **Step 1:** Write failing tests — 401; 403 wrong student; 404 attempt not found; returns status + total_grade + section breakdown when graded; returns status='submitted' (no grades yet) when still grading.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Load attempt → sections → questions for this student → responses. Compute `section_grade` by summing `response.grade` for questions in each section.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): GET /api/attempts/chapter-test/[id] (result polling — student owns attempt, four-audience)`

---

### Seg4 Task 5: `ChapterTestTimer.tsx` + `SectionCard.tsx` + `QuestionRenderer.tsx`

**Files:** Three components in `src/app/(student)/student/chapter-test/_components/`

**`ChapterTestTimer`:**
- Props: `{ startedAt: string; totalMinutes: number; onTimeUp: () => void }`
- Wall-clock timer: recomputes every second from `Date.now() - new Date(startedAt).getTime()` (honest across reloads, never a client countdown — mirrors QuizTimer pattern)
- Reads `src/app/(student)/student/quiz/_components/QuizTimer.tsx` for the exact pattern
- Shows remaining time as `MM:SS`
- Fires `onTimeUp` when elapsed >= `totalMinutes * 60`
- `prefers-reduced-motion`: snaps to `--:--` display only
- When < 5 min remaining: urgent visual tone (border-risk-surface, not just color — WCAG non-color)
- `// @vitest-environment jsdom`

**`SectionCard`:**
- Props: `{ section: SectionData; isActive: boolean; children: React.ReactNode }`
- Shows: section title, time_minutes, total_points, power_skill label (teacher-facing copy for power skill deferred to Barb)
- Token-only styling, `bg-surface` when inactive, `bg-brand-surface` when active

**`QuestionRenderer`:**
- Props: `{ question: QuestionData; response: ResponseDraft; onChange: (draft: ResponseDraft) => void }`
- Renders by `question_type`:
  - `mcq`: radio buttons from `payload.choices` — `aria-labelledby` the question_text
  - `matching`: two-column left→right pairing (dropdown-based in V2 for a11y; no drag)
  - `short_answer` / `compare_contrast` / `mini_essay` / `multi_step_problem`: `<textarea>` with `aria-label`, word-count hint
  - `data_interpretation`: if `payload.mermaid` present, renders as `<pre>` (code block, screen-reader accessible); textarea for answer
- `ResponseDraft = { response_text?: string; response_payload?: Record<string, unknown> }`
- `// @vitest-environment jsdom`

- [ ] **Step 1:** Write failing jsdom tests for each component — timer counts down, fires onTimeUp at 0; QuestionRenderer renders MCQ choices, short_answer textarea; SectionCard highlights when active.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement all three components. Read `QuizTimer.tsx` exactly for the wall-clock pattern; copy the `useEffect` interval approach.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): ChapterTestTimer + SectionCard + QuestionRenderer (MCQ/matching/short_answer/essay)`

---

### Seg4 Task 6: `ChapterTestResultScreen.tsx`

**Files:** `src/app/(student)/student/chapter-test/_components/ChapterTestResultScreen.tsx`, `__tests__/ChapterTestResultScreen.test.tsx`

**Behavior:**
- Polls `GET /api/attempts/chapter-test/[attemptId]` every 3s while `status = 'submitted'` (grading in progress)
- Shows "Grading your test…" while polling
- When `status = 'graded'`: shows
  - `total_grade` / `total_max` (e.g., "You scored 47 out of 60") — summative, student sees grade
  - Per-section collapsible breakdown: section title + section_grade / section_max
  - Expand: per-question question_text + student's response_text + ai_feedback
  - NO band/risk/CL on any string — **run `hasLeak` on all generated strings before rendering**
- Forfeit message if `forfeit_reason = 'time_up'` ("Time was up")
- "Back to assignments" link (returns to `/student/assignments`)
- `// @vitest-environment jsdom`

> **Four-audience leak test:** Must include a test asserting that no banned word from `leakGuard` appears in rendered output.

- [ ] **Step 1:** Write failing jsdom tests — renders "Grading…" while polling; shows score after graded; four-audience test (no leaked band/CL words); forfeit message; section accordion.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Read `src/lib/copy/leakGuard.ts` for `hasLeak`. Use `setInterval` for polling (clear on unmount). Apply `hasLeak` to `ai_feedback` strings before render — if leak detected, substitute a safe fallback string (log + replace, never crash).
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): ChapterTestResultScreen (polls grading, shows total_grade, four-audience leak-guarded)`

---

### Seg4 Task 7: `ChapterTestPlayer.tsx` + page

**Files:**
- `src/app/(student)/student/chapter-test/_components/ChapterTestPlayer.tsx`
- `src/app/(student)/student/chapter-test/page.tsx`
- `__tests__/ChapterTestPlayer.test.tsx`

**State machine:** `loading → ready → taking → submitting → result`

**`ChapterTestPlayer`:**
- On mount: POST `/api/attempts/chapter-test/start` with `chapterTestId`
- If response has `{ forfeited: true }`: transition to `result` state immediately (show result screen)
- `taking` state:
  - `ChapterTestTimer` (44 min wall-clock) at the top; `onTimeUp` → `handleSubmit({ forfeit_reason: 'time_up' })`
  - Section tab bar: tabs 1–5 (section title), free navigation, active section highlighted
  - Current section's `SectionCard` with `QuestionRenderer`s for each question
  - Per-question autosave: on `onChange`, debounce 2s → POST save-response (same pattern as homework player)
  - `beforeunload` handler: `navigator.sendBeacon('/api/attempts/chapter-test/save-response', ...)` for any pending unsaved response
  - "Submit test" button (always visible): prompts confirmation dialog before POSTing submit
  - Submit in progress: `submitting` state → shows spinner
- After submit: transition to `result` state → renders `ChapterTestResultScreen`
- Recovery: if resumed attempt (`started_at` already set), show a brief "You're continuing your test" banner
- `// @vitest-environment jsdom`

**Page (`page.tsx`):**
```ts
// Server component
import { requireRole } from '@/lib/auth/requireRole';
// requireRole(['student']) → userId
// Read ?chapterTestId from searchParams
// Verify chapter test is published + student is enrolled (server-side guard, fail-fast)
// Return <ChapterTestPlayer chapterTestId={...} userId={...} />
```

- [ ] **Step 1:** Write failing jsdom tests — renders loading; on start response, shows section tabs + first question; timer visible; section navigation switches active section; submit button triggers confirm dialog then POST submit; transitions to result screen.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Read `src/app/(student)/student/quiz/_components/QuizRunner.tsx` for the state machine pattern and autosave approach. Copy the debounce save pattern from the homework player (`src/app/(student)/student/assignments/_components/AssignmentPlayer.tsx` if it exists, else use the homework attempt autosave pattern). Confirmation dialog: native `window.confirm` or a simple inline modal — keep it simple.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): ChapterTestPlayer + page (5-section nav, timer, autosave, submit)`

---

## Segment 5 — Async Grading Pipeline

**Goal:** `gradeChapterAttempt` — synchronous MCQ/matching graders + Claude per-response for open-ended types + total_grade rollup. Wired into submit route via `after()`.

**Dependency order:** T1 → T2 → T3 → T4 → T5 → T6

---

### Seg5 Task 1: Synchronous exact-match graders

**Files:** Create `src/lib/chapters/gradeChapterTest.ts` (initial: exact-match functions only), `src/lib/chapters/__tests__/gradeChapterTest.test.ts`

**Functions:**
```ts
export interface GradeResult { grade: number; ai_feedback: string; }

/** MCQ: correct_answer in payload → full points or 0 */
export function gradeMcq(question: QuestionRow, response: ResponseRow): GradeResult

/** Matching: per-pair scoring (each correct pair = points/pair_count, rounded down; unmatched = 0) */
export function gradeMatching(question: QuestionRow, response: ResponseRow): GradeResult
```

Where:
- `QuestionRow.payload.correct_answer: string` for MCQ — compare with `response.response_payload.selected_answer`
- `QuestionRow.payload.pairs: {left_idx, right_idx}[]` for matching — compare with `response.response_payload.pairs`
- `grade` is clamped to `[0, question.points]`
- `ai_feedback` is a deterministic string ("Correct." / "That was {correct_answer}." etc.) — DRAFT → Barb

> **Four-audience:** `ai_feedback` for MCQ/matching should NOT reveal diagnostic labels. Simple factual feedback only: "Correct." or "The answer was [correct term]." Subject to Barb copy gate.

- [ ] **Step 1:** Write failing tests — MCQ correct → full points; MCQ wrong → 0 + feedback reveals correct answer; matching all correct → full points; matching partial → proportional; matching empty response → 0; grade never exceeds question.points.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement pure functions (no DB, no Claude — purely deterministic).
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): gradeMcq + gradeMatching (synchronous exact-match, partial credit for matching)`

---

### Seg5 Task 2: Claude open-ended grader

**Files:** Add to `src/lib/chapters/gradeChapterTest.ts`, tests alongside

**Function:**
```ts
/** Rubric-based Claude grader for short_answer, compare_contrast, data_interpretation, mini_essay, multi_step_problem */
export async function gradeOpenEnded(question: QuestionRow, response: ResponseRow): Promise<GradeResult>
```

**Prompt strategy:**
- System: "You are a fair, calibrated grader for a middle/high school test. Return JSON only: { grade: number, feedback: string }."
- User: question type, question text, rubric from `payload.rubric`, student's response_text, max points for this question
- Model: `CLAUDE_CHAPTER_MODEL` (claude-opus-4-8), **NO temperature param**
- max_tokens: 500 per question (feedback is short)
- `grade` clamped to `[0, question.points]`; `feedback` is the student-facing string (Barb gates)
- On null response (student left blank): return `{ grade: 0, ai_feedback: 'No response.' }` without a Claude call

**Fail-soft:** If `resilientClaudeChat` returns null or throws, return `{ grade: 0, ai_feedback: '' }` with a console.error — never throw. The `gradeChapterAttempt` orchestrator continues with the next question.

- [ ] **Step 1:** Write failing tests (mock `resilientClaudeChat`): short_answer with valid response → grade + feedback; null/empty response → grade=0, no Claude call; Claude returns invalid JSON → grade=0 with console.error; grade clamped to question.points.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Use `resilientClaudeChat` from `src/lib/ai/claude.ts`. JSON.parse the content. `Math.min(question.points, Math.max(0, parsed.grade))`. NEVER pass `temperature`.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): gradeOpenEnded (Claude rubric-based, no temperature, fail-soft)`

---

### Seg5 Task 3: `gradeChapterAttempt` orchestrator

**Files:** Add to `src/lib/chapters/gradeChapterTest.ts`, tests alongside

**Function:**
```ts
export async function gradeChapterAttempt(attemptId: string, admin: SupabaseClient): Promise<void>
```

**Algorithm:**
1. Load attempt → verify status is 'submitted' (skip if already graded)
2. Load chapter_test → sections → questions for this student (via `section_id IN (sections)` AND `student_id = attempt.student_id`)
3. Load existing responses for this attempt
4. For each question:
   - Find matching response (or null if student left blank)
   - Dispatch: `gradeMcq` / `gradeMatching` (sync) or `gradeOpenEnded` (async Claude) based on `question_type`
   - Upsert `chapter_test_responses` with `{ grade, ai_feedback, graded_at: now() }` (ON CONFLICT update)
   - If dispatch throws: log + assign `{ grade: 0, ai_feedback: '' }` — NEVER abort the batch
5. Sum all grades → `total_grade`; sum all `question.points` → `total_max`
6. Update `chapter_test_attempts`: `{ status: 'graded', total_grade, total_max }`
7. Wrap everything in try/catch — never throw out of `after()`

> **C4 — Forfeit grading:** A `forfeit_reason` attempt is graded the same way — with whatever responses were saved. Blank questions get grade=0. The student sees their partial grade.

> **C5 — No parallel grading:** Process questions serially (not Promise.all) at pilot scale. Claude rate limits are more likely to bite than latency is a problem for a 60-question test graded in the background.

- [ ] **Step 1:** Write failing tests — mocks `gradeMcq`, `gradeMatching`, `gradeOpenEnded`; all questions graded → total_grade = sum; one question throws → grade=0 for that question, rest continue; already-graded attempt is skipped; forfeit attempt is graded normally; `total_grade` and `status='graded'` written to attempt row.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. The function is pure orchestration — all DB + Claude logic delegated to helpers above.
- [ ] **Step 4:** Run → PASS + tsc 0.
- [ ] **Step 5:** Commit `feat(chapter-eval): gradeChapterAttempt (serial, fail-soft per question, forfeit support)`

---

### Seg5 Task 4: Wire `gradeChapterAttempt` into submit route

**Files:** Modify `src/app/api/attempts/chapter-test/submit/route.ts` (stub was in Seg4 T3)

- [ ] **Step 1:** Import `gradeChapterAttempt` from `src/lib/chapters/gradeChapterTest.ts` (was stubbed in Seg4 T3)
- [ ] **Step 2:** In the submit route's `after()` block:
```ts
after(async () => {
  try {
    await gradeChapterAttempt(attemptId, admin);
  } catch (err) {
    console.error('[chapter-test/submit] gradeChapterAttempt failed (non-fatal):', err);
    // Never throw — the 200 has already been sent
  }
});
```
- [ ] **Step 3:** Run all submit route tests → PASS + tsc 0.
- [ ] **Step 4:** Commit `feat(chapter-eval): wire gradeChapterAttempt into submit route via after()`

---

### Seg5 Task 5: Add `logAudit` to chapter test submit

**Files:** Modify `src/app/api/attempts/chapter-test/submit/route.ts`

Wire `logAudit` (from `src/lib/audit/logAudit.ts`) for the submit action:
```ts
await logAudit(admin, {
  actorId: userId,
  schoolId,   // resolve from users.school_id
  action: 'chapter_test.submit',
  resourceType: 'chapter_test_attempt',
  resourceId: attemptId,
  metadata: { chapter_test_id: chapterTestId, forfeit_reason: body.forfeit_reason ?? null },
});
```

This is best-effort (same pattern as audit log everywhere — never throw if audit fails).

- [ ] **Step 1:** Read `src/lib/audit/logAudit.ts` for the interface.
- [ ] **Step 2:** Add audit call BEFORE the `after()` block (audit the submit action, not the grading result).
- [ ] **Step 3:** Run tests → PASS + tsc 0.
- [ ] **Step 4:** Commit `feat(chapter-eval): audit log on chapter_test.submit`

---

### Seg5 Task 6: Final integration + strings

**Files:** `STRINGS-FOR-BARB.md` (add §Chapter Eval)

- [ ] **Step 1:** Run full test suite: `npm test` → verify all vitest tests pass (count should be prior count + ~80–100 new tests).
- [ ] **Step 2:** Run `npx tsc --noEmit` → 0 errors.
- [ ] **Step 3:** Run `npm run build` → 0 errors (a11y gate + tokens:check).
- [ ] **Step 4:** Add `§Chapter Eval` section to `STRINGS-FOR-BARB.md` with all draft user-facing strings:
  - Chapter management: "Add chapter", "Archive chapter", "Create Chapter Test", "Humanities", "STEM"
  - Generation states: "Building your test…", "Test ready", "Something went wrong — try again"
  - Publish: "Publish test", "✓ Published"
  - Student player: "Chapter Test", "Submit test", "Are you sure? You won't be able to change your answers.", "Time's up — your test has been submitted", "Grading your test…", "You're continuing your test"
  - Result screen: "You scored [N] out of [M]" (the [N]/[M] slots are the only digits — all else digit-free per four-audience), per-section headings, ai_feedback scaffolding
  - Teacher gradebook: chapter test column header, ChapterTestDrillIn panel headings
  - MCQ/matching feedback fallbacks: "Correct." / "The answer was [term]."
- [ ] **Step 5:** Commit `feat(chapter-eval): strings draft → STRINGS-FOR-BARB.md §Chapter Eval`

---

## Final Verification

- [ ] `npm test` green (total vitest count ~80–100 new tests across all 5 segments)
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `npm run build` → 0 (a11y + tokens:check)
- [ ] Migration 0030 SQL: reviewed for correctness — UNIQUE constraints, RLS policies, GRANT ALL
- [ ] **Whole-branch adversarial review — focus areas:**
  - IDOR: chapter + chapter_test + attempt all guarded by `guardClassAccess` / student-owns check
  - Four-audience: student result screen has no band/CL/risk words; `hasLeak` applied to ai_feedback
  - `gradeChapterAttempt` fail-soft: one bad Claude call never aborts the batch; forfeit attempts are graded
  - `generateChapterQuestions` after() pattern: never throws; generation_status='failed' on LlmExhaustedError
  - No `temperature` param anywhere in chapter-eval code that calls `resilientClaudeChat`
  - `total_grade` (not `score_pct`) everywhere in the chapter test pipeline
  - UNIQUE(section_id, student_id, question_order) idempotency in the generation engine
  - Migration 0030 deny-by-default: no authenticated SELECT/INSERT policy; service_role only
  - `lessonS.chapter_id` ON DELETE SET NULL (not CASCADE — lessons survive chapter delete)
  - ChapterTestPlayer `beforeunload` flushes pending saves
  - Wall-clock timer computed from `startedAt` (server-stamped), never a pure client countdown
- [ ] Playwright preview: teacher creates chapter → assigns lessons → generates test → publishes → gradebook column visible → student navigates to `/student/chapter-test?chapterTestId=...` → takes test → submits → result screen shows grade. Marvin approves before merge.
- [ ] Apply migration 0030 to NEW CORE live DB (separately authorized). Verify advisors all-WARN.

## Self-Review

**Spec coverage:** All locked decisions honored — D1 (full port, all 5 segments), D2 (explicit `chapters` table), D3 (locked template verbatim V1 port), D4 (per-student questions keyed on (section, student, band, LS)), D5 (`total_grade` not `score_pct`), D6 (new component tree, not quiz runner refit). Migration 0030 (T1-Seg1) has all 6 tables + `lessons.chapter_id`. Template constants (T3-Seg1 + T4-Seg1) match V1 exactly. Generation engine (T1-Seg2) is per-student per-section Claude with no temperature. Gradebook extended (Seg3). Student player has wall-clock timer, free section nav, autosave (Seg4). Grading is fail-soft serial (Seg5). Four-audience: student sees `total_grade`; per-section breakdown teacher-only in ChapterTestDrillIn; `hasLeak` on ai_feedback before student render. Strings → Barb. Gates: tsc + vitest + build.

**Segment task counts:** Seg1=7, Seg2=7, Seg3=5, Seg4=7, Seg5=6. **Total: 32 tasks.**
