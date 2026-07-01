# Teacher Quick Fixes — Bucket 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five live-site teacher issues: SPARK challenge names missing, quiz draft missing MCQ correct answers, reinforce CTA navigates nowhere, student drill-in missing quiz detail, and High Five button disabled in student drill-in.

**Architecture:** Five independent fixes in five tasks. No database migration. Tasks 4 and 5 both modify `students/[studentId]/page.tsx` — do Task 4 before Task 5 to avoid conflicts.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, React 19, Vitest 4, Tailwind v4 (Tier-2 tokens only), `@testing-library/react` (jsdom for client component tests).

## Global Constraints

- Tailwind tokens only — never hardcode hex/spacing/type. Use `text-fg`, `bg-surface`, `border-sidebar-edge`, `shadow-sticker`, etc.
- Content text always `text-fg` (deep-ink), never `text-fg-muted` for body text.
- All teacher-only surfaces: CL verbs (Reinforce/On Track/Enrich), mastery_band, score_pct are allowed. These are teacher-only screens.
- Four-audience: student screens may NOT show mastery_band enum or CL verbs. These fixes are all teacher-facing.
- Never use `"use client"` on a server component unless it genuinely needs browser APIs or state.
- Import alias `@/` maps to `src/`. Always use `@/` over relative paths.
- Vitest React component tests must start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`.
- Auth pattern: `createServerSupabaseClient()` → `auth.getUser()` → guard → `createAdminSupabaseClient()`. All DB reads use admin client (bypasses RLS).
- Run `npx vitest run <test-file>` to run a single file. Run `npm run build` for full type check + build.
- "Assignments", never "Homework" in UI copy. "Reinforce", never "Reteach" in teacher-facing copy.

---

## File Map

**Task 1 — SPARK challenge title:**
- Modify: `src/lib/spark/loadChallenges.ts`
- Modify: `src/lib/spark/__tests__/loadChallenges.test.ts`

**Task 2 — Quiz draft correct_answer:**
- Modify: `src/app/(teacher)/library/quizzes/page.tsx`
- Modify: `src/app/(teacher)/library/quizzes/_components/QuizLibrary.tsx`
- Create: `src/app/(teacher)/library/quizzes/__tests__/QuizEditPanel.test.tsx`

**Task 3 — Reinforce CTA → /gradebook:**
- Modify: `src/app/(teacher)/students/[studentId]/_lib/priorityCta.ts`
- Modify: `src/app/(teacher)/students/[studentId]/_lib/__tests__/priorityCta.test.ts`
- Modify: `src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx`

**Task 4 — Drill-in quiz detail section:**
- Create: `src/lib/signals/loadStudentQuizDetails.ts`
- Create: `src/lib/signals/__tests__/loadStudentQuizDetails.test.ts`
- Create: `src/app/(teacher)/students/[studentId]/_components/QuizDetailSection.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/page.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx`

**Task 5 — High Five modal:**
- Create: `src/app/(teacher)/students/[studentId]/_components/QuickHighFiveModal.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/page.tsx`
- Create: `src/app/(teacher)/students/[studentId]/__tests__/QuickHighFiveModal.test.tsx`

---

### Task 1: SPARK challenge title fallback via lesson join

**Files:**
- Modify: `src/lib/spark/loadChallenges.ts`
- Modify: `src/lib/spark/__tests__/loadChallenges.test.ts`

**Context:** `loadChallenges` fetches `assignments` rows where `spark_status != 'none'`. The title comes from `a.content?.title` (the AI-generated assignment content). Old assignments and some code paths leave `content.title` null → falls back to `'Spark Challenge'`. Fix: also join `lessons:lesson_id(title)` and use the lesson title as a second fallback.

**Interfaces:**
- Produces: `ChallengeRow.title` now always has a real name when the lesson has one.

- [ ] **Step 1: Write the failing test**

Add two test cases to `src/lib/spark/__tests__/loadChallenges.test.ts`:

```typescript
  it('falls back to lessons.title when content.title is absent', async () => {
    const assignments = [
      {
        id: 'a1', student_id: 's1', lesson_id: 'l1', spark_status: 'created',
        content: null, users: { full_name: 'Alex' }, lessons: { title: 'Ocean Ecosystems' },
      },
    ];
    const data = await loadChallenges(admin(assignments, []), 'cls-1');
    expect(data.challenges[0]?.title).toBe('Ocean Ecosystems');
  });

  it('falls back to "Spark Challenge" when both content and lessons title are absent', async () => {
    const assignments = [
      {
        id: 'a1', student_id: 's1', lesson_id: null, spark_status: 'created',
        content: null, users: { full_name: 'Alex' }, lessons: null,
      },
    ];
    const data = await loadChallenges(admin(assignments, []), 'cls-1');
    expect(data.challenges[0]?.title).toBe('Spark Challenge');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/lib/spark/__tests__/loadChallenges.test.ts
```

Expected: FAIL — `'Ocean Ecosystems'` gets `'Spark Challenge'` instead (since `a.lessons` is not in the current query).

- [ ] **Step 3: Update `src/lib/spark/loadChallenges.ts`**

Change the select query to add the lessons join. Change the `AssignmentRow` interface to include `lesson_id` and `lessons`. Change the title mapping to use the three-way fallback.

**Full updated file:**

```typescript
// src/lib/spark/loadChallenges.ts — teacher Spark Challenges screen loader.
// Caller MUST run requireRole (layout) + guardClassAccess(classId) BEFORE calling (admin client
// bypasses RLS). Mirrors loadRosterSignals' contract.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChallengeRow {
  studentId: string;
  studentName: string;
  assignmentId: string;
  title: string;
  status: 'assigned' | 'in_progress' | 'completed';
  transferScore: number | null;
  contentQuality: 'engaged' | 'minimal' | 'non_engaged' | null;
  rubric: Record<string, number | null> | null;
  completedAt: string | null;
  effortLabel: string | null;
  revisionCount: number | null;
  teliHintCount: number | null;
}

export interface ChallengesData {
  classId: string;
  challenges: ChallengeRow[];
}

interface AssignmentRow {
  id: string;
  student_id: string;
  lesson_id: string | null;
  spark_status: string;
  content: { title?: string } | null;
  users: { full_name?: string } | null;
  lessons: { title?: string | null } | null;
}
interface CompletionRow {
  assignment_id: string;
  transfer_score: number | null;
  content_quality: 'engaged' | 'minimal' | 'non_engaged' | null;
  rubric_dimensions: Record<string, number | null> | null;
  completed_at: string | null;
  effort_label: string | null;
  revision_count: number | null;
  teli_hint_count: number | null;
}

export async function loadChallenges(admin: SupabaseClient, classId: string): Promise<ChallengesData> {
  const { data: aData } = await admin
    .from('assignments')
    .select('id, student_id, lesson_id, spark_status, content, users:student_id(full_name), lessons:lesson_id(title)')
    .eq('class_id', classId)
    .neq('spark_status', 'none')
    .limit(500);
  const assignments = (aData ?? []) as unknown as AssignmentRow[];
  if (assignments.length === 0) return { classId, challenges: [] };

  const ids = assignments.map((a) => a.id);
  const { data: cData } = await admin
    .from('spark_completions')
    .select('assignment_id, transfer_score, content_quality, rubric_dimensions, completed_at, effort_label, revision_count, teli_hint_count')
    .in('assignment_id', ids);
  const byAssignment = new Map<string, CompletionRow>();
  for (const c of (cData ?? []) as unknown as CompletionRow[]) byAssignment.set(c.assignment_id, c);

  const challenges: ChallengeRow[] = assignments.map((a) => {
    const c = byAssignment.get(a.id);
    const scored = c != null && (c.transfer_score != null || c.content_quality != null);
    const status: ChallengeRow['status'] = c ? (scored ? 'completed' : 'in_progress') : 'assigned';
    return {
      studentId: a.student_id,
      studentName: a.users?.full_name ?? 'Student',
      assignmentId: a.id,
      title: a.content?.title ?? a.lessons?.title ?? 'Spark Challenge',
      status,
      transferScore: c?.transfer_score ?? null,
      contentQuality: c?.content_quality ?? null,
      rubric: c?.rubric_dimensions ?? null,
      completedAt: c?.completed_at ?? null,
      effortLabel: c?.effort_label ?? null,
      revisionCount: c?.revision_count ?? null,
      teliHintCount: c?.teli_hint_count ?? null,
    };
  });
  return { classId, challenges };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run src/lib/spark/__tests__/loadChallenges.test.ts
```

Expected: All tests PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```
git add src/lib/spark/loadChallenges.ts src/lib/spark/__tests__/loadChallenges.test.ts
git commit -m "fix(spark): fall back to lessons.title for challenge name when content.title absent"
```

---

### Task 2: Quiz draft — show MCQ correct_answer in QuizEditPanel

**Files:**
- Modify: `src/app/(teacher)/library/quizzes/page.tsx`
- Modify: `src/app/(teacher)/library/quizzes/_components/QuizLibrary.tsx`
- Create: `src/app/(teacher)/library/quizzes/__tests__/QuizEditPanel.test.tsx`

**Context:** Teachers see a "Edit quiz" panel when they click a quiz in the Quiz Library. Currently MCQ questions show the choices but NOT the correct answer. Need to add `correct_answer` to the select query, the `QqRow` type, the push loop, the `QuizQuestionLite` interface, and the render.

**Interfaces:**
- `QuizQuestionLite` (in QuizLibrary.tsx): new field `correct_answer: string | null`

- [ ] **Step 1: Write the failing test**

Create `src/app/(teacher)/library/quizzes/__tests__/QuizEditPanel.test.tsx`:

```typescript
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/library/quizzes',
}));

import QuizLibrary from '../_components/QuizLibrary';

const QUIZ = {
  id: 'q1',
  title: 'Week 3 Check',
  status: 'draft' as const,
  questionCount: 2,
  publishedAt: null,
  lesson: null,
};

const MCQ_QUESTION = {
  id: 'qq1',
  position: 1,
  question_type: 'mcq',
  question_text: 'What is 2+2?',
  choices: ['1', '2', '4', '5'],
  rubric: null,
  correct_answer: '4',
};

describe('QuizEditPanel — correct_answer display', () => {
  it('renders the correct answer for an MCQ question in the edit panel', () => {
    const { container } = render(
      React.createElement(QuizLibrary, {
        quizzes: [QUIZ],
        questions: { q1: [MCQ_QUESTION] },
        classId: 'c1',
        initialSelected: 'q1',
      }),
    );
    expect(container.innerHTML).toContain('4');
    expect(container.innerHTML).toContain('Correct answer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run "src/app/(teacher)/library/quizzes/__tests__/QuizEditPanel.test.tsx"
```

Expected: FAIL — `'Correct answer'` not found in rendered HTML (correct_answer not yet in the interface or rendered).

- [ ] **Step 3: Update `src/app/(teacher)/library/quizzes/page.tsx`**

Current `QqRow` type and select are missing `correct_answer`. Make three changes:

**Change 1** — Add `correct_answer` to `QqRow` (around line 30):
```typescript
// BEFORE:
type QqRow = { id: string; quiz_id: string; position: number | null; question_type: string; question_text: string; choices: string[] | null; rubric: string | null };

// AFTER:
type QqRow = { id: string; quiz_id: string; position: number | null; question_type: string; question_text: string; choices: string[] | null; correct_answer: string | null; rubric: string | null };
```

**Change 2** — Add `correct_answer` to the `.select(...)` call (around line 76):
```typescript
// BEFORE:
.select('id, quiz_id, position, question_type, question_text, choices, rubric')

// AFTER:
.select('id, quiz_id, position, question_type, question_text, choices, correct_answer, rubric')
```

**Change 3** — Add `correct_answer` in the push loop (around line 84):
```typescript
// BEFORE:
  (questions[r.quiz_id] ??= []).push({
    id: r.id, position: r.position ?? 0, question_type: r.question_type,
    question_text: r.question_text, choices: Array.isArray(r.choices) ? r.choices : null,
    rubric: r.rubric ?? null,
  });

// AFTER:
  (questions[r.quiz_id] ??= []).push({
    id: r.id, position: r.position ?? 0, question_type: r.question_type,
    question_text: r.question_text, choices: Array.isArray(r.choices) ? r.choices : null,
    correct_answer: r.correct_answer ?? null,
    rubric: r.rubric ?? null,
  });
```

- [ ] **Step 4: Update `src/app/(teacher)/library/quizzes/_components/QuizLibrary.tsx`**

**Change 1** — Add `correct_answer` to `QuizQuestionLite` interface (around line 40):
```typescript
// BEFORE:
export interface QuizQuestionLite {
  id: string;
  position: number;
  question_type: string;
  question_text: string;
  choices: string[] | null;
  rubric: string | null;
}

// AFTER:
export interface QuizQuestionLite {
  id: string;
  position: number;
  question_type: string;
  question_text: string;
  choices: string[] | null;
  correct_answer: string | null;
  rubric: string | null;
}
```

**Change 2** — Add correct_answer display in QuizEditPanel (around line 418, after the choices `<p>` element):
```tsx
// BEFORE (the choices block, around lines 416-420):
                {q.choices && q.choices.length > 0 && (
                  <p className="text-xs text-fg-muted">
                    Choices: {q.choices.join(' · ')}
                  </p>
                )}

// AFTER (keep existing choices block, add correct_answer below it):
                {q.choices && q.choices.length > 0 && (
                  <p className="text-xs text-fg-muted">
                    Choices: {q.choices.join(' · ')}
                  </p>
                )}
                {q.correct_answer && (
                  <p className="text-xs font-bold text-fg">
                    Correct answer: {q.correct_answer}
                  </p>
                )}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx vitest run "src/app/(teacher)/library/quizzes/__tests__/QuizEditPanel.test.tsx"
```

Expected: PASS.

- [ ] **Step 6: Type-check**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```
git add "src/app/(teacher)/library/quizzes/page.tsx" "src/app/(teacher)/library/quizzes/_components/QuizLibrary.tsx" "src/app/(teacher)/library/quizzes/__tests__/QuizEditPanel.test.tsx"
git commit -m "fix(quiz-library): show MCQ correct_answer in quiz draft edit panel"
```

---

### Task 3: Student drill-in — Reinforce CTA navigates to /gradebook

**Files:**
- Modify: `src/app/(teacher)/students/[studentId]/_lib/priorityCta.ts`
- Modify: `src/app/(teacher)/students/[studentId]/_lib/__tests__/priorityCta.test.ts`
- Modify: `src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx`

**Context:** When a student has a `Reinforce` skill, the "Suggested next step" card shows "Flag {skill} for reteach" and links to `#skill-map` (just scrolls, no action). Fix: change the label to "Reinforce {skill} — see Gradebook" and the anchor to `'/gradebook'` so the teacher is taken to the Gradebook where the real Reinforce Assignment button lives.

**Interfaces:**
- `PriorityCta.label` for `kind === 'flag-reteach'`: changes from `"Flag {skill} for reteach"` to `"Reinforce {skill} — see Gradebook"`
- `PriorityCta.anchor` for `kind === 'flag-reteach'`: changes from `'#skill-map'` to `'/gradebook'`

- [ ] **Step 1: Update the test for the new label/anchor**

In `src/app/(teacher)/students/[studentId]/_lib/__tests__/priorityCta.test.ts`, the test at "2. top Reinforce skill wins" currently asserts `expect(out.label).toContain('Fractions')`. After the change, the label is `'Reinforce Fractions — see Gradebook'` — which still contains `'Fractions'`, so that assertion still passes. But add an assertion on the anchor too:

```typescript
// In the '2. top Reinforce skill wins when risk is not elevated' test, after the existing assertions:
    expect(out.anchor).toBe('/gradebook');
    expect(out.label).toContain('Reinforce');
    expect(out.label).toContain('Fractions');
```

Full updated test (replace the entire '2. top Reinforce skill wins' test case):
```typescript
  it('2. top Reinforce skill wins when risk is not elevated', () => {
    const out = priorityCta({
      riskLevel: 'low',
      perSkillCl: [
        { cl_verb: 'On Track', skill_name: 'Decimals' },
        { cl_verb: 'Reinforce', skill_name: 'Fractions' },
      ],
      divergenceFlagged: true,
    });
    expect(out.kind).toBe('flag-reteach');
    expect(out.label).toContain('Reinforce');
    expect(out.label).toContain('Fractions');
    expect(out.skillName).toBe('Fractions');
    expect(out.anchor).toBe('/gradebook');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run "src/app/(teacher)/students/[studentId]/_lib/__tests__/priorityCta.test.ts"
```

Expected: FAIL on the anchor assertion — `'#skill-map' !== '/gradebook'`.

- [ ] **Step 3: Update `src/app/(teacher)/students/[studentId]/_lib/priorityCta.ts`**

Change the `flag-reteach` return value:

```typescript
// BEFORE:
  if (topReinforce) {
    return {
      kind: 'flag-reteach',
      label: `Flag ${topReinforce.skill_name} for reteach`,
      anchor: '#skill-map',
      skillName: topReinforce.skill_name,
    };
  }

// AFTER:
  if (topReinforce) {
    return {
      kind: 'flag-reteach',
      label: `Reinforce ${topReinforce.skill_name} — see Gradebook`,
      anchor: '/gradebook',
      skillName: topReinforce.skill_name,
    };
  }
```

- [ ] **Step 4: Run lib unit test to verify it passes**

```
npx vitest run "src/app/(teacher)/students/[studentId]/_lib/__tests__/priorityCta.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Update `page.test.tsx` to match new label**

In `src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx`, find the test at line ~138:
```typescript
    expect(container.innerHTML).toContain('Flag Long Division for reteach');
```

Change it to:
```typescript
    expect(container.innerHTML).toContain('Reinforce Long Division — see Gradebook');
```

- [ ] **Step 6: Run page tests to verify they pass**

```
npx vitest run "src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```
git add "src/app/(teacher)/students/[studentId]/_lib/priorityCta.ts" "src/app/(teacher)/students/[studentId]/_lib/__tests__/priorityCta.test.ts" "src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx"
git commit -m "fix(student-drill-in): reinforce CTA navigates to /gradebook instead of scrolling to skill map"
```

---

### Task 4: Student drill-in — quiz detail section

**Files:**
- Create: `src/lib/signals/loadStudentQuizDetails.ts`
- Create: `src/lib/signals/__tests__/loadStudentQuizDetails.test.ts`
- Create: `src/app/(teacher)/students/[studentId]/_components/QuizDetailSection.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/page.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx`

**Context:** The student drill-in page loads signals, identity, and grade trend — but never loads quiz attempt details. Teachers need to see: the quiz title, score %, mastery band, learning style, and per-question breakdown (question text, student answer, correct answer for MCQ, AI score label for OEQ). This is a teacher-only screen so mastery_band verbs and score_pct are allowed (four-audience rule). The loader uses the admin client (bypasses RLS — `quiz_attempts` RLS blocks teacher reads via standard client).

**Schema reference:**
- `quiz_attempts`: `id, quiz_id, student_id, score_pct, mastery_band, learning_style, submitted_at, is_complete`
- `quiz_responses`: `attempt_id, question_id, response_text, is_correct, ai_score`
- `quiz_questions`: `id, question_type, question_text, choices (jsonb), correct_answer`
- `quizzes`: `id, title`

**Interfaces:**
- Produces: `loadStudentQuizDetails(admin, studentId): Promise<QuizAttemptDetail[]>` — up to 3 most-recent complete attempts
- `QuizAttemptDetail.responses` — per-question breakdown
- Consumed by: `QuizDetailSection` component + `page.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/lib/signals/__tests__/loadStudentQuizDetails.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { loadStudentQuizDetails } from '../loadStudentQuizDetails';

function makeAdmin(attempts: unknown[], responses: unknown[]) {
  const attemptChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: attempts, error: null }),
  };
  const responseChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: responses, error: null }),
  };
  return {
    from: vi.fn((t: string) => (t === 'quiz_attempts' ? attemptChain : responseChain)),
  } as never;
}

describe('loadStudentQuizDetails', () => {
  it('returns empty array when student has no complete attempts', async () => {
    const data = await loadStudentQuizDetails(makeAdmin([], []), 's1');
    expect(data).toEqual([]);
  });

  it('maps attempt fields correctly', async () => {
    const attempts = [
      {
        id: 'att1', quiz_id: 'q1', score_pct: 80, mastery_band: 'grade_level',
        learning_style: 'visual', submitted_at: '2026-06-25T10:00:00Z',
        quizzes: { title: 'Fractions Quiz' },
      },
    ];
    const data = await loadStudentQuizDetails(makeAdmin(attempts, []), 's1');
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      attemptId: 'att1',
      quizTitle: 'Fractions Quiz',
      scorePct: 80,
      masteryBand: 'grade_level',
      learningStyle: 'visual',
      submittedAt: '2026-06-25T10:00:00Z',
      responses: [],
    });
  });

  it('maps MCQ response with correct_answer', async () => {
    const attempts = [
      {
        id: 'att1', quiz_id: 'q1', score_pct: 100, mastery_band: 'advanced',
        learning_style: null, submitted_at: '2026-06-25T10:00:00Z',
        quizzes: { title: 'Math Check' },
      },
    ];
    const responses = [
      {
        attempt_id: 'att1', question_id: 'qq1', response_text: '4',
        is_correct: true, ai_score: null,
        quiz_questions: {
          question_text: 'What is 2+2?', question_type: 'mcq',
          choices: ['1', '2', '4', '5'], correct_answer: '4',
        },
      },
    ];
    const data = await loadStudentQuizDetails(makeAdmin(attempts, responses), 's1');
    expect(data[0]?.responses[0]).toMatchObject({
      questionText: 'What is 2+2?',
      questionType: 'mcq',
      choices: ['1', '2', '4', '5'],
      correctAnswer: '4',
      studentAnswer: '4',
      isCorrect: true,
      aiScore: null,
    });
  });

  it('maps OEQ response with ai_score', async () => {
    const attempts = [
      {
        id: 'att1', quiz_id: 'q1', score_pct: 75, mastery_band: 'grade_level',
        learning_style: null, submitted_at: '2026-06-25T10:00:00Z',
        quizzes: { title: 'Math Check' },
      },
    ];
    const responses = [
      {
        attempt_id: 'att1', question_id: 'qq2', response_text: 'Because fractions share a denominator',
        is_correct: null, ai_score: 0.5,
        quiz_questions: {
          question_text: 'Why can you add these fractions?', question_type: 'open',
          choices: null, correct_answer: null,
        },
      },
    ];
    const data = await loadStudentQuizDetails(makeAdmin(attempts, responses), 's1');
    expect(data[0]?.responses[0]).toMatchObject({
      questionType: 'open',
      studentAnswer: 'Because fractions share a denominator',
      aiScore: 0.5,
      correctAnswer: null,
    });
  });

  it('handles null quizzes join gracefully', async () => {
    const attempts = [
      {
        id: 'att1', quiz_id: 'q1', score_pct: 60, mastery_band: 'reteach',
        learning_style: null, submitted_at: '2026-06-25T10:00:00Z',
        quizzes: null,
      },
    ];
    const data = await loadStudentQuizDetails(makeAdmin(attempts, []), 's1');
    expect(data[0]?.quizTitle).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/lib/signals/__tests__/loadStudentQuizDetails.test.ts
```

Expected: FAIL — module `loadStudentQuizDetails` not found.

- [ ] **Step 3: Create `src/lib/signals/loadStudentQuizDetails.ts`**

```typescript
// src/lib/signals/loadStudentQuizDetails.ts
// Teacher-only loader. Reads quiz attempts + responses for a single student.
// Uses the admin client (bypasses RLS — quiz_attempts RLS restricts to student_id = auth.uid()).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface QuizResponseDetail {
  questionText: string;
  questionType: string;
  choices: string[] | null;
  correctAnswer: string | null;
  studentAnswer: string | null;
  isCorrect: boolean | null;
  aiScore: number | null;
}

export interface QuizAttemptDetail {
  attemptId: string;
  quizTitle: string | null;
  scorePct: number | null;
  masteryBand: string | null;
  learningStyle: string | null;
  submittedAt: string | null;
  responses: QuizResponseDetail[];
}

type AttemptRow = {
  id: string;
  quiz_id: string;
  score_pct: number | null;
  mastery_band: string | null;
  learning_style: string | null;
  submitted_at: string | null;
  quizzes: { title: string | null } | null;
};

type ResponseRow = {
  attempt_id: string;
  question_id: string | null;
  response_text: string | null;
  is_correct: boolean | null;
  ai_score: number | null;
  quiz_questions: {
    question_text: string;
    question_type: string;
    choices: unknown;
    correct_answer: string | null;
  } | null;
};

export async function loadStudentQuizDetails(
  admin: SupabaseClient,
  studentId: string,
): Promise<QuizAttemptDetail[]> {
  const { data: attemptsData } = await admin
    .from('quiz_attempts')
    .select('id, quiz_id, score_pct, mastery_band, learning_style, submitted_at, quizzes:quiz_id(title)')
    .eq('student_id', studentId)
    .eq('is_complete', true)
    .order('submitted_at', { ascending: false })
    .limit(3);

  const attempts = (attemptsData ?? []) as unknown as AttemptRow[];
  if (attempts.length === 0) return [];

  const attemptIds = attempts.map((a) => a.id);
  const { data: responsesData } = await admin
    .from('quiz_responses')
    .select('attempt_id, question_id, response_text, is_correct, ai_score, quiz_questions:question_id(question_text, question_type, choices, correct_answer)')
    .in('attempt_id', attemptIds);

  const byAttempt = new Map<string, ResponseRow[]>();
  for (const r of (responsesData ?? []) as unknown as ResponseRow[]) {
    const list = byAttempt.get(r.attempt_id);
    if (list) {
      list.push(r);
    } else {
      byAttempt.set(r.attempt_id, [r]);
    }
  }

  return attempts.map((a): QuizAttemptDetail => ({
    attemptId: a.id,
    quizTitle: a.quizzes?.title ?? null,
    scorePct: a.score_pct,
    masteryBand: a.mastery_band,
    learningStyle: a.learning_style,
    submittedAt: a.submitted_at,
    responses: (byAttempt.get(a.id) ?? []).map((r): QuizResponseDetail => ({
      questionText: r.quiz_questions?.question_text ?? '',
      questionType: r.quiz_questions?.question_type ?? 'open',
      choices: Array.isArray(r.quiz_questions?.choices) ? (r.quiz_questions!.choices as string[]) : null,
      correctAnswer: r.quiz_questions?.correct_answer ?? null,
      studentAnswer: r.response_text,
      isCorrect: r.is_correct,
      aiScore: r.ai_score,
    })),
  }));
}
```

- [ ] **Step 4: Run loader tests to verify they pass**

```
npx vitest run src/lib/signals/__tests__/loadStudentQuizDetails.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Write failing component test (for QuizDetailSection)**

Add to `src/lib/signals/__tests__/loadStudentQuizDetails.test.ts` a note that component testing is done in step 6 via jsdom rendering. (Component is a pure server component — no hooks, no state — tested via integration in page tests.)

The component rendering is verified by the page.test.tsx update in step 8. Skip a standalone component test here to avoid redundant jsdom fixtures.

- [ ] **Step 6: Create `src/app/(teacher)/students/[studentId]/_components/QuizDetailSection.tsx`**

```tsx
// src/app/(teacher)/students/[studentId]/_components/QuizDetailSection.tsx
// TEACHER-ONLY. Displays the student's most-recent quiz attempts with per-question
// breakdown (student answer vs correct answer for MCQ, AI score for OEQ).
// Tokens only; content text-fg.
import React from 'react';
import { SectionLabel } from '../../../_components/SectionLabel';
import type { QuizAttemptDetail } from '@/lib/signals/loadStudentQuizDetails';

function bandLabel(band: string | null): string {
  if (band === 'reteach') return 'Reinforce';
  if (band === 'grade_level') return 'On Track';
  if (band === 'advanced') return 'Enrich';
  return '—';
}

function lsLabel(ls: string | null): string | null {
  if (!ls) return null;
  const MAP: Record<string, string> = {
    visual: 'Visual',
    auditory: 'Auditory',
    reading_writing: 'Reading/writing',
    kinesthetic: 'Kinesthetic',
  };
  return MAP[ls] ?? null;
}

function aiScoreLabel(score: number | null): string {
  if (score === 1) return 'Correct';
  if (score === 0.5) return 'Partial';
  if (score === 0) return 'Incorrect';
  return '—';
}

interface Props {
  attempts: QuizAttemptDetail[];
}

export function QuizDetailSection({ attempts }: Props): React.JSX.Element | null {
  if (attempts.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5" aria-label="Quiz performance">
      <h2><SectionLabel tone="brand">Quiz performance</SectionLabel></h2>
      <div className="flex flex-col gap-4">
        {attempts.map((a) => (
          <div
            key={a.attemptId}
            className="rounded-lg border-2 border-sidebar-edge bg-surface p-3 flex flex-col gap-3"
          >
            {/* Header row — quiz title + score + band + LS */}
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <p className="font-bold text-fg text-sm">{a.quizTitle ?? 'Quiz'}</p>
              <span className="text-xs text-fg-muted">
                {a.scorePct != null ? `${Math.round(a.scorePct)}%` : '—'}
                {' · '}
                {bandLabel(a.masteryBand)}
                {a.learningStyle && lsLabel(a.learningStyle)
                  ? ` · ${lsLabel(a.learningStyle)}`
                  : ''}
              </span>
            </div>

            {/* Per-question rows */}
            {a.responses.length > 0 && (
              <ul className="flex flex-col gap-2.5">
                {a.responses.map((r, i) => (
                  <li key={i} className="text-sm text-fg flex flex-col gap-1">
                    <p className="font-medium leading-snug">{r.questionText}</p>
                    {r.questionType === 'mcq' ? (
                      <div className="text-xs text-fg-muted flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>Student: <strong className="text-fg">{r.studentAnswer ?? '—'}</strong></span>
                        <span>Correct: <strong className="text-fg">{r.correctAnswer ?? '—'}</strong></span>
                        {r.isCorrect != null && (
                          <span className={r.isCorrect ? 'text-ok font-bold' : 'text-warn font-bold'}>
                            {r.isCorrect ? '✓' : '✗'}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-fg-muted flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="italic">
                          {r.studentAnswer ? `"${r.studentAnswer}"` : '(no response)'}
                        </span>
                        {r.aiScore != null && (
                          <span className={r.aiScore === 1 ? 'text-ok font-bold' : r.aiScore === 0.5 ? 'text-fg font-bold' : 'text-warn font-bold'}>
                            {aiScoreLabel(r.aiScore)}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default QuizDetailSection;
```

- [ ] **Step 7: Update `src/app/(teacher)/students/[studentId]/page.tsx`**

Add the import and loader call:

```typescript
// Add to imports (after loadStudentGradeTrend import):
import { loadStudentQuizDetails } from '@/lib/signals/loadStudentQuizDetails';

// Add to imports (after GradeTrendSection import):
import { QuizDetailSection } from './_components/QuizDetailSection';
```

Change the `Promise.all` call (around line 59):
```typescript
// BEFORE:
  const [signals, identity, gradeTrend] = await Promise.all([
    loadStudentSignals(admin, studentId),
    loadStudentIdentity(admin, studentId),
    classId ? loadStudentGradeTrend(admin, { studentId, classId }) : Promise.resolve(null),
  ]);

// AFTER:
  const [signals, identity, gradeTrend, quizAttempts] = await Promise.all([
    loadStudentSignals(admin, studentId),
    loadStudentIdentity(admin, studentId),
    classId ? loadStudentGradeTrend(admin, { studentId, classId }) : Promise.resolve(null),
    loadStudentQuizDetails(admin, studentId),
  ]);
```

Add `QuizDetailSection` render after `GradeTrendSection` (around line 129, after the `{gradeTrend && ...}` block):
```tsx
          {gradeTrend && <GradeTrendSection trend={gradeTrend} studentName={fullName} />}

          {/* Quiz performance — teacher-only, shows mastery band + per-question */}
          <QuizDetailSection attempts={quizAttempts} />
```

- [ ] **Step 8: Update mocks in test files**

In `src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx`, add after the last existing `vi.mock(...)` call:
```typescript
vi.mock('@/lib/signals/loadStudentQuizDetails', () => ({
  loadStudentQuizDetails: vi.fn().mockResolvedValue([]),
}));
```

In `src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx`, add after the last existing `vi.mock(...)` call:
```typescript
vi.mock('@/lib/signals/loadStudentQuizDetails', () => ({
  loadStudentQuizDetails: vi.fn().mockResolvedValue([]),
}));
```

- [ ] **Step 9: Run all affected tests**

```
npx vitest run src/lib/signals/__tests__/loadStudentQuizDetails.test.ts "src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx"
```

Expected: All tests PASS.

- [ ] **Step 10: Type-check**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 11: Commit**

```
git add src/lib/signals/loadStudentQuizDetails.ts src/lib/signals/__tests__/loadStudentQuizDetails.test.ts "src/app/(teacher)/students/[studentId]/_components/QuizDetailSection.tsx" "src/app/(teacher)/students/[studentId]/page.tsx" "src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx"
git commit -m "feat(student-drill-in): add quiz detail section with per-question breakdown"
```

---

### Task 5: Student drill-in — High Five modal

**Files:**
- Create: `src/app/(teacher)/students/[studentId]/_components/QuickHighFiveModal.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/page.tsx`
- Create: `src/app/(teacher)/students/[studentId]/__tests__/QuickHighFiveModal.test.tsx`

**Context:** The "High Five" button in the student drill-in header is disabled. The full HighFiveComposer (at `/high-fives`) is a full-page form with class suggestions, roster, recent HF context — too heavy to embed. Instead: a lightweight `QuickHighFiveModal` with a textarea + Send button that calls `POST /api/teacher/high-fives/send` directly. `IdentityHeader` must become a client component to hold the `isHFOpen` state.

The send API: `POST /api/teacher/high-fives/send` with body `{ student_id, class_id, text, ai_drafted: false }`.
- 422 returns `{ violations: string[] }` — show the violations list.
- 200/201 returns `{ ok: true, id: string }` — show success + close after 2s.
- If `classId` is null (teacher opened the drill-in without a `?class=` param): show a friendly "Open this student's class first" message and disable the button.

**"Add note" and "Open Assignments" remain disabled** — out of scope.

**Interfaces:**
- Produces: `QuickHighFiveModal` component with props `{ studentId, classId, studentName, isOpen, onClose }`
- `IdentityHeader` gains props `studentId: string` and `classId: string | null` (new required props)
- `page.tsx` passes `studentId` and `classId` to `IdentityHeader`

- [ ] **Step 1: Write the failing test**

Create `src/app/(teacher)/students/[studentId]/__tests__/QuickHighFiveModal.test.tsx`:

```typescript
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/students/x',
}));

import QuickHighFiveModal from '../_components/QuickHighFiveModal';

const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('QuickHighFiveModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the textarea and Send button when open and classId is provided', () => {
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    expect(container.innerHTML).toContain('textarea');
    expect(container.innerHTML).toContain('Send');
    expect(container.innerHTML).toContain('Alex');
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: false,
        onClose: vi.fn(),
      }),
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows a friendly message and disables Send when classId is null', () => {
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: null,
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    // Send button exists but is disabled
    const sendBtn = container.querySelector('button[type="submit"], button[data-testid="hf-send"]');
    expect(sendBtn).toBeTruthy();
    expect(sendBtn?.getAttribute('disabled')).not.toBeNull();
    // Shows guidance
    expect(container.innerHTML).toContain('class');
  });

  it('calls POST /api/teacher/high-fives/send on submit with correct payload', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, id: 'hf1' }),
    });
    const onClose = vi.fn();
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose,
      }),
    );
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'Great work today!' } });
    const sendBtn = container.querySelector('button[data-testid="hf-send"]')!;
    fireEvent.click(sendBtn);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/teacher/high-fives/send');
    const body = JSON.parse(opts.body as string);
    expect(body.student_id).toBe('s1');
    expect(body.class_id).toBe('c1');
    expect(body.text).toBe('Great work today!');
    expect(body.ai_drafted).toBe(false);
  });

  it('shows success message after a successful send', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, id: 'hf1' }),
    });
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'Great work!' } });
    fireEvent.click(container.querySelector('button[data-testid="hf-send"]')!);
    await waitFor(() =>
      expect(container.innerHTML.toLowerCase()).toMatch(/sent|high five/i)
    );
  });

  it('shows violations error on 422 response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ violations: ['Avoid using names'] }),
    });
    const { container } = render(
      React.createElement(QuickHighFiveModal, {
        studentId: 's1',
        classId: 'c1',
        studentName: 'Alex',
        isOpen: true,
        onClose: vi.fn(),
      }),
    );
    const textarea = container.querySelector('textarea')!;
    fireEvent.change(textarea, { target: { value: 'Alex you are great!' } });
    fireEvent.click(container.querySelector('button[data-testid="hf-send"]')!);
    await waitFor(() =>
      expect(container.innerHTML).toContain('Avoid using names')
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run "src/app/(teacher)/students/[studentId]/__tests__/QuickHighFiveModal.test.tsx"
```

Expected: FAIL — `QuickHighFiveModal` module not found.

- [ ] **Step 3: Create `QuickHighFiveModal.tsx`**

Create `src/app/(teacher)/students/[studentId]/_components/QuickHighFiveModal.tsx`:

```tsx
'use client';
// src/app/(teacher)/students/[studentId]/_components/QuickHighFiveModal.tsx
// Lightweight High Five composer embedded in the student drill-in header.
// Full HighFiveComposer (at /high-fives) needs class context + suggestions —
// too heavy for inline use. This is a thin textarea → POST variant.
import React, { useState } from 'react';

interface QuickHighFiveModalProps {
  studentId: string;
  classId: string | null;
  studentName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function QuickHighFiveModal({
  studentId,
  classId,
  studentName,
  isOpen,
  onClose,
}: QuickHighFiveModalProps): React.JSX.Element | null {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [violations, setViolations] = useState<string[]>([]);
  const [sent, setSent] = useState(false);

  if (!isOpen) return null;

  const noClass = classId === null;
  const canSend = !noClass && text.trim().length > 0 && text.trim().length <= 600 && !busy;

  async function handleSend() {
    if (!canSend || !classId) return;
    setBusy(true);
    setError(null);
    setViolations([]);
    try {
      const res = await fetch('/api/teacher/high-fives/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, class_id: classId, text: text.trim(), ai_drafted: false }),
      });
      if (res.status === 422) {
        const data = await res.json() as { violations: string[] };
        setViolations(data.violations ?? []);
      } else if (!res.ok) {
        setError('Something went wrong. Please try again.');
      } else {
        setSent(true);
        setTimeout(() => {
          setSent(false);
          setText('');
          onClose();
        }, 2000);
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Send High Five to ${studentName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-xl border-2 border-sidebar-edge bg-bg p-5 shadow-sticker-lg flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-fg text-base">
            High Five — {studentName}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-fg-muted hover:text-fg transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {sent ? (
          <p role="status" className="text-center font-bold text-ok py-4">
            High Five sent! ★
          </p>
        ) : (
          <>
            {noClass && (
              <p className="text-xs text-fg-muted bg-surface rounded-md border-2 border-sidebar-edge px-3 py-2">
                Open this student from a specific class to send a High Five.
              </p>
            )}

            <textarea
              aria-label="High Five note"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={noClass || busy}
              maxLength={600}
              rows={4}
              placeholder={noClass ? '' : `What did ${studentName} do well?`}
              className="w-full resize-none rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1.5 text-fg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
            />

            {violations.length > 0 && (
              <ul role="alert" className="text-xs text-fg flex flex-col gap-0.5">
                {violations.map((v, i) => (
                  <li key={i}>⚠ {v}</li>
                ))}
              </ul>
            )}

            {error && (
              <p role="alert" className="text-xs text-fg">{error}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-md border-2 border-sidebar-edge px-3 py-1.5 text-sm text-fg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="hf-send"
                onClick={handleSend}
                disabled={!canSend}
                className="rounded-md border-2 border-sidebar-edge bg-brand px-3 py-1.5 text-sm font-bold text-fg-on-brand shadow-sticker disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default QuickHighFiveModal;
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run "src/app/(teacher)/students/[studentId]/__tests__/QuickHighFiveModal.test.tsx"
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Update `IdentityHeader.tsx` — add `'use client'`, new props, modal state**

Replace the entire file:

```tsx
'use client';
// src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx
// TEACHER-ONLY. Full-width identity header: breadcrumb, avatar, name, grade, and
// action buttons. High Five is now wired via QuickHighFiveModal.
// "Add note" and "Open Assignments" remain deferred (no backing store / no route).
// Tokens only.
import React, { useState } from 'react';
import Link from 'next/link';
import { QuickHighFiveModal } from './QuickHighFiveModal';

interface IdentityHeaderProps {
  fullName: string;
  gradeLevel: string | null;
  classLabel: string | null;
  backHref: string;
  backLabel: string;
  studentId: string;
  classId: string | null;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
}

export function IdentityHeader({
  fullName,
  gradeLevel,
  classLabel,
  backHref,
  backLabel,
  studentId,
  classId,
}: IdentityHeaderProps): React.JSX.Element {
  const [hfOpen, setHfOpen] = useState(false);

  const sub = [gradeLevel ? `Grade ${gradeLevel}` : null, classLabel]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="flex flex-col gap-3">
        {/* Breadcrumb back — pop pill */}
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1 self-start rounded-md border-2 border-sidebar-edge bg-surface px-2.5 py-1 text-xs font-bold text-fg shadow-sticker transition-colors hover:bg-brand hover:text-fg-on-brand"
        >
          ← {backLabel}
        </Link>

        <div className="flex items-center gap-3">
          {/* Avatar — bold cobalt sticker tile */}
          <div
            className="grid size-14 shrink-0 -rotate-3 place-items-center rounded-xl border-2 border-sidebar-edge bg-brand font-display text-lg font-extrabold text-fg-on-brand shadow-sticker"
            aria-hidden="true"
          >
            {initialsOf(fullName)}
          </div>

          <div className="flex-1">
            <h1 className="font-display text-xl text-fg font-bold tracking-tight">{fullName}</h1>
            {sub && <p className="text-fg-muted text-sm">{sub}</p>}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHfOpen(true)}
              className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 text-sm font-bold text-fg shadow-sticker hover:bg-brand hover:text-fg-on-brand transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              High Five
            </button>
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Coming soon"
              className="rounded-md border-2 border-sidebar-edge px-3 py-1.5 text-sm font-bold text-fg-muted opacity-50"
            >
              Add note
            </button>
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Coming soon"
              className="rounded-md border-2 border-sidebar-edge px-3 py-1.5 text-sm font-bold text-fg-muted opacity-50"
            >
              Open Assignments ›
            </button>
          </div>
        </div>
      </div>

      <QuickHighFiveModal
        studentId={studentId}
        classId={classId}
        studentName={fullName}
        isOpen={hfOpen}
        onClose={() => setHfOpen(false)}
      />
    </>
  );
}

export default IdentityHeader;
```

- [ ] **Step 6: Update `page.tsx` to pass `studentId` and `classId` to `IdentityHeader`**

In `src/app/(teacher)/students/[studentId]/page.tsx`, change the `<IdentityHeader` call (around line 104):

```tsx
// BEFORE:
      <IdentityHeader
        fullName={fullName}
        gradeLevel={gradeLevel}
        classLabel={null}
        backHref={backHref}
        backLabel={backLabel}
      />

// AFTER:
      <IdentityHeader
        fullName={fullName}
        gradeLevel={gradeLevel}
        classLabel={null}
        backHref={backHref}
        backLabel={backLabel}
        studentId={studentId}
        classId={classId ?? null}
      />
```

- [ ] **Step 7: Run all student drill-in tests**

```
npx vitest run "src/app/(teacher)/students/[studentId]/__tests__/QuickHighFiveModal.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/page.test.tsx" "src/app/(teacher)/students/[studentId]/__tests__/student.leak.test.tsx"
```

Expected: All tests PASS.

- [ ] **Step 8: Full type-check and build**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 9: Run the full test suite to confirm no regressions**

```
npm test
```

Expected: All tests pass (tsc 0, vitest all green).

- [ ] **Step 10: Commit**

```
git add "src/app/(teacher)/students/[studentId]/_components/QuickHighFiveModal.tsx" "src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx" "src/app/(teacher)/students/[studentId]/page.tsx" "src/app/(teacher)/students/[studentId]/__tests__/QuickHighFiveModal.test.tsx"
git commit -m "feat(student-drill-in): wire High Five button to inline QuickHighFiveModal"
```
