# CL → Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate per-skill differentiated assignments — a section per lesson skill, each at that skill's Comprehension Level (Reinforce→scaffolded, On Track→standard, Enrich→extension), every task tagged to its skill and naming its power (critical-thinking) skill — and route each task's grade back to its skill's CL.

**Architecture:** Resolve the lesson's skills (lesson→quiz→`quiz_questions.skill_id`), load the student's per-skill CL from `skill_learning_state`, map to per-skill levels (confidence-gated), and thread a `skillTargets` list into `generateAssignment`. The engine emits a flat, **`step`-keyed** `tasks[]` array (the immutable identity invariant) where tasks are grouped in skill order and each carries `skill_id`/`skill_name`/`power_skill`. The student player renders the current task's skill name as a section heading (level/verb never serialized). `assignments.skill_ids` is populated, and `recomputeSkillStates` attributes each task's grade to its own skill.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Zod, Vitest 4, Supabase (admin client). No new dependency. **No migration** (all tables/columns exist).

## Global Constraints

- **No migration.** `skill_learning_state`, `skills`, `quiz_questions.skill_id`, `assignments.skill_ids` all already exist; new per-task fields live inside the existing `content` jsonb.
- **`step` (integer) is the immutable task identity** across generate→persist→player→autosave→drawing→grade→moat. Never renumber, nest, or re-key tasks. Sections are presentation + tagging over a flat `tasks[]` array.
- **Four-audience wall:** the per-skill **level** (`scaffolded`/`standard`/`extension`) and the **CL verb** (`Reinforce`/`On Track`/`Enrich`) MUST NEVER be serialized to the student client or appear in any student-visible string. Only the non-diagnostic **skill name** may be shown. Guarded by a `.leak.test`.
- **Conservative confidence gate:** a skill steers its section's level only when its CL verb is non-null AND `confidence >= 40`; otherwise it falls back to the anchor band's mode. The feature can only improve an assignment, never worsen it on a weak signal.
- **Backward compatible:** when zero skills resolve (untagged lesson / fully cold student), `generateAssignment` produces exactly today's single-band, untagged assignment. The per-skill path is strictly additive.
- **Section cap = 4 skills**, ordered Reinforce-first → On Track → Enrich → cold last; non-silent `console.warn` on truncation.
- **Quizzes are untouched** (diagnostic; never personalized at generation).
- Gates: `npx tsc --noEmit` 0 · full `npm test` green · `npm run build` 0 (a11y + tokens). Any student-visible heading copy → `STRINGS-FOR-BARB.md §CL Generation`.

## File Structure

- `src/lib/utils/scoring.ts` (modify) — add `assignmentModeToBand` (inverse of existing `bandToAssignmentMode`).
- `src/lib/skills/skillTargets.ts` (create) — pure: `SkillTarget` type, `levelForVerb`, `orderAndCapTargets`, constants.
- `src/lib/skills/loadSkillTargets.ts` (create) — thin loader: per-skill CL → `SkillTarget[]`.
- `src/lib/lessons/resolveLessonSkills.ts` (create) — lesson → its skills.
- `src/lib/engine/types.ts` (modify) — add `skill_id`/`skill_name`/`power_skill` to `AssignmentTaskSchema`.
- `src/lib/openai/prompts.ts` (modify) — `AssignmentSection` types; `assignmentPrompt` sectioned variant.
- `src/lib/engine/assignmentGen.ts` (modify) — `AssignmentInput.skillTargets`; build sections; pass power_skill (6th strategy field).
- `src/app/api/teacher/assignments/generate/route.ts` (modify) — resolve skills + targets; thread; populate `skill_ids`.
- `src/app/api/teacher/assignments/reinforce/route.ts` (modify) — same inside `after()`.
- `src/lib/assignments/loadAssignmentForPlay.ts` (modify) — pass `skill_name` through `normalizeContent`.
- `src/app/(student)/student/assignments/[id]/play/_components/AssignmentPlayer.tsx` (modify) — render section heading.
- `src/lib/skills/perTaskAttribution.ts` (create) — pure: extract per-task skill tags + build per-task homework observations.
- `src/lib/skills/recomputeSkillStates.ts` (modify) — per-skill averaged attribution when tagged.

## Task Dependency & Ordering

Execute in this exact order (dependencies in parens):
1. **Task A** (pure helpers + `MODE_TO_BAND`/`assignmentModeToBand`) — no deps.
2. **Task B** (loadSkillTargets) — needs A.
3. **Task C** (resolveLessonSkills) — no deps.
4. **Task D** (schema + power_skill) — no deps. **⚠️ Do NOT run `tsc`/`npm run build` after Task D alone** — its strategy payload gains a 6th field that the `assignmentPrompt` param type only accepts after Task E. Run ONLY the Task D unit test. tsc is green again after Task E.
5. **Task E** (sectioned prompt + engine) — needs A, D.
6. **Task F** (generate route) — needs A, B, C, E.
7. **Task G** (reinforce route) — needs A, B, C, E.
8. **Task H** (player heading + leak guard) — needs D (the `skill_name` field).
9. **Task I** (moat per-skill attribution) — needs D (persisted per-task `skill_id`).

**Demo visibility (verify, do not assume):** the feature only shows when a lesson's quiz questions carry `skill_id` (else `resolveLessonSkills` → `[]` → today's single-band path — correct but invisible). The shipped moat (Insights) already depends on `quiz_questions.skill_id` for the demo classes, so the demo is expected to be tagged. Confirm during the final Playwright preview: generate an assignment on a demo lesson and verify ≥2 skill sections appear; if the demo is untagged, flag it (a demo-seed tag pass is a follow-up, NOT a blocker — the feature is still correct).

---

### Task A: `assignmentModeToBand` + skill-target pure helpers

**Files:**
- Modify: `src/lib/utils/scoring.ts` (add one function near `bandToAssignmentMode` at line 97)
- Create: `src/lib/skills/skillTargets.ts`
- Test: `src/lib/skills/__tests__/skillTargets.test.ts`

**Interfaces:**
- Consumes: `AssignmentMode`, `MasteryBand` from `@/types/core`; `CL_VERB_BY_STATE`, `SkillLearningState` from `@/lib/skills/clVerbs`.
- Produces: `SkillTarget` type, `levelForVerb(verb, confidence, fallback)`, `orderAndCapTargets(targets)`, `SKILL_TARGET_CAP=4`, `CONFIDENCE_STEER_MIN=40`, `type CLVerb`; and `assignmentModeToBand(mode): MasteryBand`.

- [ ] **Step 1: Write the failing test** — `src/lib/skills/__tests__/skillTargets.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { levelForVerb, orderAndCapTargets, SKILL_TARGET_CAP, type SkillTarget } from '@/lib/skills/skillTargets';
import { assignmentModeToBand, bandToAssignmentMode } from '@/lib/utils/scoring';

afterEach(() => vi.restoreAllMocks());

describe('levelForVerb', () => {
  it('maps confident verbs to levels', () => {
    expect(levelForVerb('Reinforce', 80, 'standard')).toBe('scaffolded');
    expect(levelForVerb('On Track', 80, 'scaffolded')).toBe('standard');
    expect(levelForVerb('Enrich', 80, 'standard')).toBe('extension');
  });
  it('falls back when verb is null (cold)', () => {
    expect(levelForVerb(null, 90, 'standard')).toBe('standard');
  });
  it('falls back when confidence is below the steer floor or null', () => {
    expect(levelForVerb('Reinforce', 39, 'standard')).toBe('standard');
    expect(levelForVerb('Reinforce', null, 'extension')).toBe('extension');
    expect(levelForVerb('Reinforce', 40, 'standard')).toBe('scaffolded'); // boundary: 40 steers
  });
});

describe('orderAndCapTargets', () => {
  const mk = (skill_id: string, verb: SkillTarget['verb']): SkillTarget =>
    ({ skill_id, skill_name: skill_id, level: 'standard', verb, confident: verb != null });

  it('orders Reinforce → On Track → Enrich → cold(null)', () => {
    const out = orderAndCapTargets([mk('a', 'Enrich'), mk('b', null), mk('c', 'Reinforce'), mk('d', 'On Track')]);
    expect(out.map((t) => t.skill_id)).toEqual(['c', 'd', 'a', 'b']);
  });
  it('caps at SKILL_TARGET_CAP and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const many = Array.from({ length: 6 }, (_, i) => mk(`s${i}`, 'Reinforce'));
    const out = orderAndCapTargets(many);
    expect(out).toHaveLength(SKILL_TARGET_CAP);
    expect(warn).toHaveBeenCalled();
  });
});

describe('assignmentModeToBand', () => {
  it('is the inverse of bandToAssignmentMode', () => {
    for (const band of ['reteach', 'grade_level', 'advanced'] as const) {
      expect(assignmentModeToBand(bandToAssignmentMode(band))).toBe(band);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/skills/__tests__/skillTargets.test.ts`
Expected: FAIL — modules/functions not found.

- [ ] **Step 3: Add the shared mode↔band map + `assignmentModeToBand` to `src/lib/utils/scoring.ts`** (immediately after `bandToAssignmentMode`, line 99)

```ts
/** Single source of truth for level(mode)→band, shared by assignmentModeToBand and the
 *  sectioned prompt (avoids a duplicated literal map drifting out of sync). */
export const MODE_TO_BAND: Record<AssignmentMode, MasteryBand> = {
  scaffolded: 'reteach',
  standard: 'grade_level',
  extension: 'advanced',
};

export function assignmentModeToBand(mode: AssignmentMode): MasteryBand {
  return MODE_TO_BAND[mode];
}
```

- [ ] **Step 4: Create `src/lib/skills/skillTargets.ts`**

```ts
// src/lib/skills/skillTargets.ts
// Pure helpers mapping a student's per-skill Comprehension Level to a per-skill
// assignment level, with a conservative confidence gate + a Reinforce-first cap.
import type { AssignmentMode } from '@/types/core';

export type CLVerb = 'Reinforce' | 'On Track' | 'Enrich';

export interface SkillTarget {
  skill_id: string;
  skill_name: string;
  level: AssignmentMode;     // 'scaffolded' | 'standard' | 'extension'
  verb: CLVerb | null;       // null = cold / not-yet-assessed
  confident: boolean;        // verb present AND confidence >= CONFIDENCE_STEER_MIN
}

export const SKILL_TARGET_CAP = 4;
export const CONFIDENCE_STEER_MIN = 40;

const LEVEL_BY_VERB: Record<CLVerb, AssignmentMode> = {
  Reinforce: 'scaffolded',
  'On Track': 'standard',
  Enrich: 'extension',
};

/** Conservative gate: only a present verb with confidence >= 40 steers; else fallback. */
export function levelForVerb(
  verb: CLVerb | null,
  confidence: number | null,
  fallback: AssignmentMode,
): AssignmentMode {
  if (verb == null) return fallback;
  if (confidence == null || confidence < CONFIDENCE_STEER_MIN) return fallback;
  return LEVEL_BY_VERB[verb];
}

const VERB_ORDER: Record<string, number> = { Reinforce: 0, 'On Track': 1, Enrich: 2 };

/** Reinforce-first → On Track → Enrich → cold(null) last; cap at 4 (warn on truncation). */
export function orderAndCapTargets(targets: SkillTarget[]): SkillTarget[] {
  const sorted = [...targets].sort(
    (a, b) => (VERB_ORDER[a.verb ?? ''] ?? 3) - (VERB_ORDER[b.verb ?? ''] ?? 3),
  );
  if (sorted.length > SKILL_TARGET_CAP) {
    console.warn(`[skillTargets] ${sorted.length} skills resolved — capping to ${SKILL_TARGET_CAP} (Reinforce-first)`);
    return sorted.slice(0, SKILL_TARGET_CAP);
  }
  return sorted;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/skills/__tests__/skillTargets.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/lib/skills/skillTargets.ts src/lib/skills/__tests__/skillTargets.test.ts src/lib/utils/scoring.ts
git commit -m "feat(cl-gen): skill-target level mapping + assignmentModeToBand (pure)"
```

---

### Task B: `loadSkillTargets` loader

**Files:**
- Create: `src/lib/skills/loadSkillTargets.ts`
- Test: `src/lib/skills/__tests__/loadSkillTargets.test.ts`

**Interfaces:**
- Consumes: `levelForVerb`, `orderAndCapTargets`, `SkillTarget` (Task A); `CL_VERB_BY_STATE`/`SkillLearningState` (`@/lib/skills/clVerbs`); `bandToAssignmentMode` (`@/lib/utils/scoring`); `MasteryBand` (`@/types/core`).
- Produces: `loadSkillTargets(admin, { studentId, skills, fallbackBand }): Promise<SkillTarget[]>` where `skills: { skill_id: string; skill_name: string }[]`.

- [ ] **Step 1: Write the failing test** — `src/lib/skills/__tests__/loadSkillTargets.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { loadSkillTargets } from '@/lib/skills/loadSkillTargets';

// Minimal admin stub: skill_learning_state select → in() returns the seeded rows.
function adminWith(rows: { skill_id: string; state: string; confidence: number | null }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  } as never;
}

describe('loadSkillTargets', () => {
  it('returns [] when no skills given (no query)', async () => {
    const out = await loadSkillTargets({} as never, { studentId: 's1', skills: [], fallbackBand: 'grade_level' });
    expect(out).toEqual([]);
  });

  it('maps states to confident levels and cold skills to the fallback', async () => {
    const admin = adminWith([
      { skill_id: 'frac', state: 'needs_more_time', confidence: 80 },   // Reinforce
      { skill_id: 'dec', state: 'ready_to_extend', confidence: 75 },    // Enrich
      // 'geo' has no row → cold → fallback
    ]);
    const out = await loadSkillTargets(admin, {
      studentId: 's1',
      skills: [
        { skill_id: 'frac', skill_name: 'Fractions' },
        { skill_id: 'dec', skill_name: 'Decimals' },
        { skill_id: 'geo', skill_name: 'Geometry' },
      ],
      fallbackBand: 'grade_level', // → 'standard'
    });
    const byId = Object.fromEntries(out.map((t) => [t.skill_id, t]));
    expect(byId.frac.level).toBe('scaffolded');
    expect(byId.frac.verb).toBe('Reinforce');
    expect(byId.dec.level).toBe('extension');
    expect(byId.geo.level).toBe('standard'); // cold → fallback
    expect(byId.geo.verb).toBeNull();
    // ordering: Reinforce(frac) → Enrich(dec) → cold(geo)
    expect(out.map((t) => t.skill_id)).toEqual(['frac', 'dec', 'geo']);
  });

  it('treats low-confidence as cold (fallback level, confident=false)', async () => {
    const admin = adminWith([{ skill_id: 'frac', state: 'needs_more_time', confidence: 20 }]);
    const out = await loadSkillTargets(admin, {
      studentId: 's1', skills: [{ skill_id: 'frac', skill_name: 'Fractions' }], fallbackBand: 'advanced',
    });
    expect(out[0].level).toBe('extension'); // fallback = bandToAssignmentMode('advanced')
    expect(out[0].confident).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/skills/__tests__/loadSkillTargets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/skills/loadSkillTargets.ts`**

```ts
// src/lib/skills/loadSkillTargets.ts
// Loads a student's per-skill Comprehension Level for a given set of skills and
// maps each to a per-skill assignment level (confidence-gated). Cold / low-confidence
// skills fall back to the anchor band's mode. Admin-client read; the caller has already
// established the student via the route's IDOR guard.
import type { SupabaseClient } from '@supabase/supabase-js';
import { CL_VERB_BY_STATE, type SkillLearningState } from '@/lib/skills/clVerbs';
import { bandToAssignmentMode } from '@/lib/utils/scoring';
import type { MasteryBand } from '@/types/core';
import { levelForVerb, orderAndCapTargets, CONFIDENCE_STEER_MIN, type SkillTarget } from '@/lib/skills/skillTargets';

export async function loadSkillTargets(
  admin: SupabaseClient,
  args: { studentId: string; skills: { skill_id: string; skill_name: string }[]; fallbackBand: MasteryBand },
): Promise<SkillTarget[]> {
  if (args.skills.length === 0) return [];
  const fallbackMode = bandToAssignmentMode(args.fallbackBand);
  const ids = args.skills.map((s) => s.skill_id);

  const { data } = await admin
    .from('skill_learning_state')
    .select('skill_id, state, confidence')
    .eq('student_id', args.studentId)
    .in('skill_id', ids);

  const byId = new Map<string, { state: string; confidence: number | null }>();
  for (const r of (data ?? []) as { skill_id: string; state: string; confidence: number | null }[]) {
    byId.set(r.skill_id, { state: r.state, confidence: r.confidence });
  }

  const targets: SkillTarget[] = args.skills.map((s) => {
    const row = byId.get(s.skill_id);
    const verb = row ? CL_VERB_BY_STATE[row.state as SkillLearningState] ?? null : null;
    const confidence = row?.confidence ?? null;
    return {
      skill_id: s.skill_id,
      skill_name: s.skill_name,
      level: levelForVerb(verb, confidence, fallbackMode),
      verb,
      confident: verb != null && confidence != null && confidence >= CONFIDENCE_STEER_MIN,
    };
  });

  return orderAndCapTargets(targets);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/skills/__tests__/loadSkillTargets.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/skills/loadSkillTargets.ts src/lib/skills/__tests__/loadSkillTargets.test.ts
git commit -m "feat(cl-gen): loadSkillTargets — per-skill CL → assignment level"
```

---

### Task C: `resolveLessonSkills` loader

**Files:**
- Create: `src/lib/lessons/resolveLessonSkills.ts`
- Test: `src/lib/lessons/__tests__/resolveLessonSkills.test.ts`

**Interfaces:**
- Produces: `resolveLessonSkills(admin, lessonId): Promise<{ skill_id: string; skill_name: string }[]>` (distinct, in first-seen order).

**Note:** lessons have no direct skill column; a lesson's skills = the distinct `skill_id`s of its quizzes' questions. First confirm `quiz_questions` has a `quiz_id` FK and `skills(id, name)` is joinable (migration 0005). Resolution: `quizzes WHERE lesson_id` → `quiz_questions WHERE quiz_id IN (...) AND skill_id NOT NULL` joining `skills(id, name)`.

- [ ] **Step 1: Write the failing test** — `src/lib/lessons/__tests__/resolveLessonSkills.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolveLessonSkills } from '@/lib/lessons/resolveLessonSkills';

function admin({ quizzes, questions }: { quizzes: { id: string }[]; questions: { skill_id: string | null; skills: { id: string; name: string } | null }[] }) {
  return {
    from: (table: string) => {
      if (table === 'quizzes') {
        return { select: () => ({ eq: async () => ({ data: quizzes, error: null }) }) };
      }
      // quiz_questions
      return {
        select: () => ({ in: () => ({ not: async () => ({ data: questions, error: null }) }) }),
      };
    },
  } as never;
}

describe('resolveLessonSkills', () => {
  it('returns [] when the lesson has no quizzes', async () => {
    const out = await resolveLessonSkills(admin({ quizzes: [], questions: [] }), 'lesson1');
    expect(out).toEqual([]);
  });
  it('returns distinct skills (deduped, first-seen order) from quiz questions', async () => {
    const out = await resolveLessonSkills(
      admin({
        quizzes: [{ id: 'q1' }],
        questions: [
          { skill_id: 'frac', skills: { id: 'frac', name: 'Fractions' } },
          { skill_id: 'dec', skills: { id: 'dec', name: 'Decimals' } },
          { skill_id: 'frac', skills: { id: 'frac', name: 'Fractions' } }, // dup
          { skill_id: null, skills: null }, // untagged → ignored
        ],
      }),
      'lesson1',
    );
    expect(out).toEqual([
      { skill_id: 'frac', skill_name: 'Fractions' },
      { skill_id: 'dec', skill_name: 'Decimals' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/lessons/__tests__/resolveLessonSkills.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/lessons/resolveLessonSkills.ts`**

```ts
// src/lib/lessons/resolveLessonSkills.ts
// A lesson's skills = the distinct skills tagged on its quizzes' questions
// (lessons have no direct skill column). Used to scope per-skill CL for assignment
// generation. Returns [] for an untagged lesson → callers fall back to single-band.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function resolveLessonSkills(
  admin: SupabaseClient,
  lessonId: string,
): Promise<{ skill_id: string; skill_name: string }[]> {
  const { data: quizRows } = await admin.from('quizzes').select('id').eq('lesson_id', lessonId);
  const quizIds = ((quizRows ?? []) as { id: string }[]).map((q) => q.id);
  if (quizIds.length === 0) return [];

  const { data: qRows } = await admin
    .from('quiz_questions')
    .select('skill_id, skills(id, name)')
    .in('quiz_id', quizIds)
    .not('skill_id', 'is', null);

  const seen = new Map<string, string>();
  for (const row of (qRows ?? []) as { skill_id: string | null; skills: { id: string; name: string } | null }[]) {
    if (row.skill_id && row.skills && !seen.has(row.skill_id)) {
      seen.set(row.skill_id, row.skills.name);
    }
  }
  return [...seen.entries()].map(([skill_id, skill_name]) => ({ skill_id, skill_name }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/lessons/__tests__/resolveLessonSkills.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lessons/resolveLessonSkills.ts src/lib/lessons/__tests__/resolveLessonSkills.test.ts
git commit -m "feat(cl-gen): resolveLessonSkills — lesson → its tagged skills"
```

---

### Task D: Assignment schema + power-skill (6th strategy field)

**Files:**
- Modify: `src/lib/engine/types.ts:130-138` (`AssignmentTaskSchema`)
- Modify: `src/lib/engine/assignmentGen.ts:51-57` (strategy extraction)
- Test: `src/lib/engine/__tests__/types.assignment.test.ts` (create)

**Interfaces:**
- Produces: `AssignmentTaskSchema` accepts optional `skill_id: string|null`, `skill_name: string`, `power_skill: string`; old (untagged) task shapes still parse. `generateAssignment`'s strategy objects now include `power_skill` (= each strategy's `critical_thinking_skill`).

**Why optional:** the LLM may omit a tag; making the fields required would fail the whole parse → no assignment. Optional fields keep the never-fabricate fail-safe; the player/moat tolerate missing tags (degrade to no heading / assignment-level attribution).

- [ ] **Step 1: Write the failing test** — `src/lib/engine/__tests__/types.assignment.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { AssignmentSchema } from '@/lib/engine/types';

const base = {
  title: 'T', mode: 'standard', learning_style: 'visual',
  reading_passage: 'p', audio_script: 'a', diagram_mode: 'none' as const,
  diagram_description: null, diagram_svg_prompt: null, diagram_image_prompt: null,
  youtube_search_query: 'q', instructions: 'i', atl_summary: [], ib_attributes: [],
};
const task = { step: 1, description: 'd', type: 'write' as const, strategy: 's', atl_skill: 'a', ib_attribute: 'i', bloom_level: 'Understand' };

describe('AssignmentSchema per-skill fields', () => {
  it('accepts tasks WITH skill_id/skill_name/power_skill', () => {
    const r = AssignmentSchema.safeParse({ ...base, tasks: [
      { ...task, skill_id: 'frac', skill_name: 'Fractions', power_skill: 'Monitor' },
      { ...task, step: 2, skill_id: 'dec', skill_name: 'Decimals', power_skill: 'Analyze' },
    ] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tasks[0].skill_name).toBe('Fractions');
  });
  it('still accepts legacy untagged tasks (backward compat)', () => {
    const r = AssignmentSchema.safeParse({ ...base, tasks: [task, { ...task, step: 2 }] });
    expect(r.success).toBe(true);
  });
  it('tolerates a null skill_id (cold/degrade)', () => {
    const r = AssignmentSchema.safeParse({ ...base, tasks: [
      { ...task, skill_id: null, skill_name: 'Fractions', power_skill: 'Monitor' }, { ...task, step: 2 },
    ] });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engine/__tests__/types.assignment.test.ts`
Expected: FAIL — schema rejects the extra fields (Zod strips unknown keys by default, so `skill_name` would be undefined → the `.toBe('Fractions')` assertion fails).

- [ ] **Step 3: Add the three optional fields to `AssignmentTaskSchema`** (`src/lib/engine/types.ts:130-138`)

```ts
const AssignmentTaskSchema = z.object({
  step: z.number().int(),
  description: z.string(),
  type: z.enum(['read', 'write', 'draw', 'discuss', 'create', 'analyze']),
  strategy: z.string(),
  atl_skill: z.string(),
  ib_attribute: z.string(),
  bloom_level: z.string(),
  // CL → generation: per-skill section tagging. Optional so an untagged (single-band)
  // or partially-tagged LLM response still parses (never fabricate / never hard-fail).
  skill_id: z.string().nullable().optional(),
  skill_name: z.string().optional(),
  power_skill: z.string().optional(),
});
```

- [ ] **Step 4: Pass `power_skill` in the engine strategy extraction** (`src/lib/engine/assignmentGen.ts:51-57`)

```ts
  const strategies = getStrategiesForStudent(input.band, input.style).map((s) => ({
    name: s.name,
    what_students_do: s.what_students_do,
    atl_skills: s.atl_skills,
    ib_learner_profile: s.ib_learner_profile,
    bloom_level: s.bloom_level,
    power_skill: s.critical_thinking_skill,
  }));
```

(The single-band `assignmentPrompt` strategy param type is widened in Task E to accept the optional `power_skill`; until then this is type-compatible because Task E lands before the route tasks. If the implementer runs tsc here it will pass — the prompt param already lists the 5 fields and accepts excess via structural typing only if widened; see Task E. Run only the unit test in this task, not tsc.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/engine/__tests__/types.assignment.test.ts`
Expected: PASS (all 3).

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/types.ts src/lib/engine/assignmentGen.ts src/lib/engine/__tests__/types.assignment.test.ts
git commit -m "feat(cl-gen): per-skill task fields + power_skill in strategy payload"
```

---

### Task E: `assignmentPrompt` sectioned variant + `generateAssignment` sections

**Files:**
- Modify: `src/lib/openai/prompts.ts` (add `AssignmentSection` types near line 745; add `sections` param to `assignmentPrompt`)
- Modify: `src/lib/engine/assignmentGen.ts` (`AssignmentInput.skillTargets`; build sections; pass through)
- Test: `src/lib/openai/__tests__/assignmentPrompt.sections.test.ts` (create)
- Test: `src/lib/engine/__tests__/assignmentGen.test.ts` (extend — add a sectioned-path case; keep existing cases green)

**Interfaces:**
- Consumes: `SkillTarget` (Task A), `assignmentModeToBand` (Task A), `getStrategiesForStudent` (existing).
- Produces: `assignmentPrompt(lessonSummary, band, style, studentName, strategies?, sparkEnabled?, targetedPractice?, sections?)`; `AssignmentInput.skillTargets?: SkillTarget[]`; exported `AssignmentSection`/`AssignmentSectionStrategy` types.

- [ ] **Step 1: Write the failing test** — `src/lib/openai/__tests__/assignmentPrompt.sections.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { assignmentPrompt, type AssignmentSection } from '@/lib/openai/prompts';

const sections: AssignmentSection[] = [
  { skill_id: 'frac', skill_name: 'Fractions', level: 'scaffolded',
    strategies: [{ name: 'Text Detective', what_students_do: 'hunt for clues', atl_skills: ['Thinking'], ib_learner_profile: ['Thinkers'], bloom_level: 'Understand', power_skill: 'Monitor' }] },
  { skill_id: 'dec', skill_name: 'Decimals', level: 'extension',
    strategies: [{ name: 'Idea Mapping', what_students_do: 'map ideas', atl_skills: ['Thinking'], ib_learner_profile: ['Thinkers'], bloom_level: 'Analyze', power_skill: 'Analyze' }] },
];

describe('assignmentPrompt sectioned variant', () => {
  const p = assignmentPrompt('LESSON', 'grade_level', 'visual', 'Maria', undefined, false, false, sections);
  it('lists each skill section in order with its level + power skill', () => {
    expect(p).toContain('SKILL SECTIONS');
    expect(p.indexOf('Fractions')).toBeLessThan(p.indexOf('Decimals')); // order preserved
    expect(p).toContain('SCAFFOLDED RETEACH'); // frac level label
    expect(p).toContain('EXTENSION ADVANCED'); // dec level label
    expect(p).toContain('Power skill: Monitor');
  });
  it('asks every task to carry skill_id, skill_name, and power_skill', () => {
    expect(p).toContain('"skill_id"');
    expect(p).toContain('"skill_name"');
    expect(p).toContain('"power_skill"');
  });
  it('omits the section block entirely when no sections (single-band path unchanged)', () => {
    const single = assignmentPrompt('LESSON', 'grade_level', 'visual', 'Maria');
    expect(single).not.toContain('SKILL SECTIONS');
    expect(single).not.toContain('"power_skill"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/openai/__tests__/assignmentPrompt.sections.test.ts`
Expected: FAIL — `AssignmentSection` not exported / `sections` param absent.

- [ ] **Step 3: Add section types + widen the strategy param** in `src/lib/openai/prompts.ts` (just above `export function assignmentPrompt`, ~line 744)

```ts
export interface AssignmentSectionStrategy {
  name: string;
  what_students_do: string;
  atl_skills: string[];
  ib_learner_profile: string[];
  bloom_level: string;
  power_skill: string;
}
export interface AssignmentSection {
  skill_id: string;
  skill_name: string;
  level: 'scaffolded' | 'standard' | 'extension';
  strategies: AssignmentSectionStrategy[];
}
```

Widen the existing `strategies?` param type (line 750) to allow the optional `power_skill`:

```ts
  strategies?: { name: string; what_students_do: string; atl_skills: string[]; ib_learner_profile: string[]; bloom_level: string; power_skill?: string }[],
```

Add the new param at the END of the signature (after `targetedPractice?`, line 758):

```ts
  sections?: AssignmentSection[],
```

- [ ] **Step 4: Build the section block, reconcile the band block, inject** in `assignmentPrompt` body

Import the shared map at the top of `prompts.ts`:

```ts
import { MODE_TO_BAND } from '@/lib/utils/scoring';
```

After `const bp = bandProfiles[band] || bandProfiles.grade_level;` (line 884), add:

```ts
  const sectionsOn = !!(sections && sections.length > 0);
  const skillSectionsBlock = sectionsOn
    ? `
═══════════════════════════════════════
SKILL SECTIONS — GENERATE TASKS GROUPED BY SKILL, IN THIS ORDER
═══════════════════════════════════════
${studentName}'s understanding differs by skill. Generate the tasks GROUPED BY the skills below, in this exact order. Write each skill's tasks at THAT skill's LEVEL using the per-level verb/Bloom rules below. THESE PER-SECTION RULES OVERRIDE the single "BAND CONSTRAINTS" task-complexity/verb/Bloom guidance for the TASKS; the BAND CONSTRAINTS still govern the reading_passage, audio_script, and diagram. Generate 1-2 tasks per skill. Tag EVERY task with its skill_id and skill_name, and put the strategy's power skill in the task's power_skill field.

FORBIDDEN IN STUDENT-VISIBLE TEXT: never write any of these words/labels into the title, reading_passage, audio_script, instructions, skill_name, or any task description — scaffolded, standard, extension, reteach, reinforce, "on track", enrich, mastery, band, "grade level", "above grade level", partial, remedial, advanced (as a label). The skill_name shows the TOPIC only (e.g. "Fractions"), never a level.
${sections!.map((sec, i) => {
      const lp = bandProfiles[MODE_TO_BAND[sec.level]] || bandProfiles.grade_level;
      const strat = sec.strategies.length
        ? sec.strategies.map((s) => `    • "${s.name}" — ${s.what_students_do} — ATL: ${s.atl_skills.join(', ')} — IB: ${s.ib_learner_profile.join(', ')} — Bloom: ${s.bloom_level} — Power skill: ${s.power_skill}`).join('\n')
        : `    • (Assign appropriate Inteliflow strategies for this level and ${style} style; each task still names a strategy, an ATL skill, an IB attribute, a Bloom level, AND a power skill.)`;
      return `
Section ${i + 1} — Skill "${sec.skill_name}" (skill_id: ${sec.skill_id}) — LEVEL (internal, never shown): ${lp.label}
  Task verbs: ${lp.verb_starters}
  Forbidden: ${lp.forbidden}
  Bloom's level: ${lp.bloom}
  Strategies (embed one per task; copy its power skill into the task's power_skill):
${strat}`;
    }).join('\n')}

CONSTRAINT: Tasks MUST appear grouped by skill in the order above. A scaffolded section MUST obey its verb/Bloom limits even when a later section is harder.`
    : '';
```

**Reconcile the BAND CONSTRAINTS block** so it does NOT contradict the per-section levels. In the returned template (lines 930-936), make the four task-governing lines conditional on `sectionsOn` (reading-level/passage-length/tone stay — they govern the passage):

```ts
Reading level: ${bp.reading_level}
${sectionsOn ? 'Task complexity, verbs, forbidden types, and Bloom level are set PER SKILL — see SKILL SECTIONS below. The lines below govern the reading passage only.' : `Task complexity: ${bp.task_complexity}
Task verb starters to use: ${bp.verb_starters}
FORBIDDEN task types: ${bp.forbidden}`}
Passage length: ${bp.passage_length}
Tone: ${bp.tone}
${sectionsOn ? '' : `Bloom's taxonomy: ${bp.bloom}`}
```

In the returned template, immediately AFTER the `STRATEGY + CORE POWERS CONSTRAINTS` block (`${strategyBlock}`, line 953), insert `${skillSectionsBlock}`.

**Reconcile SELF-CHECK rule 1** (line 973, which assumes one band) — make it section-aware:

```ts
1. ${sectionsOn ? 'For EACH skill section: are that section\'s tasks calibrated to the section\'s level (a scaffolded section markedly simpler, an extension section markedly harder)? If any section\'s tasks ignore its level — rewrite that section.' : 'Would a reteach student find this assignment significantly simpler than a grade_level version? If not — rewrite.'}
```

In the task JSON example (lines 1012-1021), append the three fields conditional on `sectionsOn`:

```ts
      "bloom_level": "Bloom's taxonomy level"${sectionsOn ? `,
      "skill_id": "the skill_id of the section this task belongs to",
      "skill_name": "the TOPIC name of the section, shown to the student (e.g. \\"Fractions\\") — NEVER a level word",
      "power_skill": "the power skill (critical-thinking skill) from the strategy used"` : ''}
```

- [ ] **Step 5: Add `skillTargets` to `AssignmentInput` + build sections in `generateAssignment`** (`src/lib/engine/assignmentGen.ts`)

Add the import at the top:

```ts
import { assignmentModeToBand } from '@/lib/utils/scoring';
import type { SkillTarget } from '@/lib/skills/skillTargets';
import type { AssignmentSection } from '@/lib/openai/prompts';
```

Add to `AssignmentInput` (after `targetedPractice?`, line 41):

```ts
  /** Per-skill CL targets for this lesson. When present, the assignment is sectioned
   *  per skill (each at its own level) and tasks are tagged. Empty/absent → single-band. */
  skillTargets?: SkillTarget[];
```

In `generateAssignment`, after the existing `strategies` extraction (line 57), build sections and pass them:

```ts
  const sections: AssignmentSection[] = (input.skillTargets ?? []).map((t) => ({
    skill_id: t.skill_id,
    skill_name: t.skill_name,
    level: t.level,
    strategies: getStrategiesForStudent(assignmentModeToBand(t.level), input.style).map((s) => ({
      name: s.name,
      what_students_do: s.what_students_do,
      atl_skills: s.atl_skills,
      ib_learner_profile: s.ib_learner_profile,
      bloom_level: s.bloom_level,
      power_skill: s.critical_thinking_skill,
    })),
  }));

  const userPrompt = assignmentPrompt(
    input.lessonSummary,
    input.band,
    input.style,
    input.studentName,
    strategies,
    input.sparkEnabled,
    input.targetedPractice,
    sections.length > 0 ? sections : undefined,
  );
```

(Replace the existing `assignmentPrompt(...)` call at lines 59-67 with the above.)

- [ ] **Step 6: Extend the engine test** — add to `src/lib/engine/assignmentGen.test.ts` (mirror this file's EXISTING `claudeChat` mock harness to capture the user prompt; do not invent a new one).

**Required assertions (ALL must be present — a test missing these is not done):**
- Captures the user prompt passed to the LLM when `generateAssignment` is called with `skillTargets: [{skill_id:'frac',skill_name:'Fractions',level:'scaffolded',verb:'Reinforce',confident:true}, {skill_id:'dec',skill_name:'Decimals',level:'extension',verb:'Enrich',confident:true}]`.
- `expect(prompt).toContain('SKILL SECTIONS')`
- `expect(prompt.indexOf('Fractions')).toBeLessThan(prompt.indexOf('Decimals'))` (order preserved)
- `expect(prompt).toContain('OVERRIDE')` (the band-block reconciliation sentence is present)
- `expect(prompt).toMatch(/FORBIDDEN IN STUDENT-VISIBLE TEXT/)` (the forbidden-words guard is in the prompt)
- A SEPARATE assertion that with NO `skillTargets`, the prompt does NOT contain `'SKILL SECTIONS'` (single-band path unchanged).
- The mocked LLM returns valid sectioned JSON (tasks carry skill_id/skill_name/power_skill) and `generateAssignment` returns a parsed `Assignment` with those task fields intact.

(Keep ALL existing assignmentGen tests green.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/openai/__tests__/assignmentPrompt.sections.test.ts src/lib/engine/__tests__/assignmentGen.test.ts src/lib/openai/__tests__/prompts.test.ts`
Expected: PASS (new + all existing).

- [ ] **Step 8: Commit**

```bash
git add src/lib/openai/prompts.ts src/lib/engine/assignmentGen.ts src/lib/openai/__tests__/assignmentPrompt.sections.test.ts src/lib/engine/__tests__/assignmentGen.test.ts
git commit -m "feat(cl-gen): sectioned assignmentPrompt + generateAssignment skillTargets"
```

---

### Task F: Wire the generate route (post-quiz)

**Files:**
- Modify: `src/app/api/teacher/assignments/generate/route.ts`
- Test: `src/app/api/teacher/assignments/generate/__tests__/route.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveLessonSkills` (Task C), `loadSkillTargets` (Task B).
- Produces: the inserted `assignments` row now sets `skill_ids` (the resolved lesson skill ids) and the generated assignment is sectioned per skill.

- [ ] **Step 1: Write the failing test** — extend `route.test.ts` (use the file's established Supabase-chain mock; spy `generateAssignment` via `vi.mock('@/lib/engine/assignmentGen')`; capture the `.insert(...)` payload).

**Required assertions (ALL must be present):**

```ts
it('resolves lesson skills, threads skillTargets, and persists skill_ids', async () => {
  // Arrange: lesson resolves to [{skill_id:'frac',skill_name:'Fractions'},{skill_id:'dec',skill_name:'Decimals'}]
  // (mock resolveLessonSkills via vi.mock('@/lib/lessons/resolveLessonSkills')) and seed
  // skill_learning_state so loadSkillTargets yields targets — OR mock loadSkillTargets directly.
  // Act: POST a graded attempt (mirror the happy-path mock).
  // Assert:
  const genArg = generateAssignmentSpy.mock.calls[0][0];
  expect(Array.isArray(genArg.skillTargets)).toBe(true);
  expect(genArg.skillTargets.length).toBeGreaterThanOrEqual(1);
  expect(insertPayload.skill_ids).toEqual(['frac', 'dec']);
});

it('falls back to single-band (no skillTargets, skill_ids=[]) for an untagged lesson', async () => {
  // resolveLessonSkills → []  (mock returns [])
  const genArg = generateAssignmentSpy.mock.calls[0][0];
  expect(genArg.skillTargets ?? []).toEqual([]);   // single-band path
  expect(insertPayload.skill_ids).toEqual([]);      // backward compat
});
```

(`generateAssignmentSpy` and `insertPayload` are captured from the file's existing mock harness — wire them; do not write a vacuous test that asserts only a 200.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/teacher/assignments/generate/__tests__/route.test.ts`
Expected: FAIL — `skill_ids` not in the insert; no skillTargets threaded.

- [ ] **Step 3: Wire the route** (`generate/route.ts`)

Add imports:

```ts
import { resolveLessonSkills } from '@/lib/lessons/resolveLessonSkills';
import { loadSkillTargets } from '@/lib/skills/loadSkillTargets';
```

After `style` is resolved and BEFORE the `generateAssignment` call (line 151), add:

```ts
    // ── CL → generation: resolve this lesson's skills + the student's per-skill CL ──
    const lessonSkills = lessonId ? await resolveLessonSkills(admin, lessonId) : [];
    const skillTargets = await loadSkillTargets(admin, {
      studentId: attempt.student_id as string,
      skills: lessonSkills,
      fallbackBand: band,
    });
```

Pass `skillTargets` into the engine call (line 152):

```ts
    const assignment = await generateAssignment({
      lessonSummary,
      band,
      style,
      studentName,
      skillTargets,
    });
```

Add `skill_ids` to the insert payload (line 162, within `.insert({ ... })`):

```ts
        skill_ids: lessonSkills.map((s) => s.skill_id),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/teacher/assignments/generate/__tests__/route.test.ts`
Expected: PASS (new + all existing C15/C20/C17/C6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/teacher/assignments/generate/route.ts src/app/api/teacher/assignments/generate/__tests__/route.test.ts
git commit -m "feat(cl-gen): generate route resolves skills, threads CL targets, populates skill_ids"
```

---

### Task G: Wire the reinforce route

**Files:**
- Modify: `src/app/api/teacher/assignments/reinforce/route.ts`
- Test: `src/app/api/teacher/assignments/reinforce/__tests__/route.test.ts` (extend)

**Interfaces:** same consumers as Task F. `fallbackBand='reteach'` (the reinforce anchor). Resolution happens before `after()` returns 202 OR inside `after()` — see Step 3 (must run inside `after()` since it awaits DB + must not block the 202).

- [ ] **Step 1: Write the failing test** — extend `reinforce/__tests__/route.test.ts` (the file's harness runs `after()` inline; spy `generateAssignment`, capture the insert payload).

**Required assertions:**

```ts
it('threads skillTargets and persists skill_ids on the reinforced assignment', async () => {
  // lesson resolves to [{skill_id:'frac',skill_name:'Fractions'}]; mirror the reinforce happy path.
  const genArg = generateAssignmentSpy.mock.calls[0][0];
  expect(genArg.band).toBe('reteach');
  expect((genArg.skillTargets ?? []).length).toBeGreaterThanOrEqual(1);
  expect(insertPayload.skill_ids).toEqual(['frac']);
});

it('still creates a reinforced assignment with skill_ids=[] when the lesson is untagged', async () => {
  // resolveLessonSkills → []; assert insertPayload.skill_ids === [] and a row is still inserted.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/teacher/assignments/reinforce/__tests__/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire the route** (`reinforce/route.ts`)

Add imports:

```ts
import { resolveLessonSkills } from '@/lib/lessons/resolveLessonSkills';
import { loadSkillTargets } from '@/lib/skills/loadSkillTargets';
```

Inside `after(async () => { ... })`, at the top of the `try` (before `generateAssignment`, line 139):

```ts
      const lessonSkills = lessonId ? await resolveLessonSkills(admin, lessonId) : [];
      const skillTargets = await loadSkillTargets(admin, {
        studentId,
        skills: lessonSkills,
        fallbackBand: 'reteach',
      });
      const assignment = await generateAssignment({
        lessonSummary,
        band: 'reteach',
        style: learningStyle,
        studentName,
        skillTargets,
      });
```

Add `skill_ids` to the insert payload (line 148, within `.insert({ ... })`):

```ts
          skill_ids: lessonSkills.map((s) => s.skill_id),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/teacher/assignments/reinforce/__tests__/route.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/teacher/assignments/reinforce/route.ts src/app/api/teacher/assignments/reinforce/__tests__/route.test.ts
git commit -m "feat(cl-gen): reinforce route threads CL targets + populates skill_ids"
```

---

### Task H: Player section heading + leak guard

**Files:**
- Modify: `src/lib/copy/leakGuard.ts` (export a shared diagnostic-vocab check)
- Modify: `src/lib/assignments/loadAssignmentForPlay.ts:12,28-39` (pass ONLY `skill_name` through)
- Modify: `src/app/(student)/student/assignments/[id]/play/_components/AssignmentPlayer.tsx:388-422` (render heading when ≥2 distinct skills)
- Test: `src/lib/assignments/__tests__/loadAssignmentForPlay.test.ts` (extend)
- Test: `src/app/(student)/student/assignments/[id]/play/_components/__tests__/AssignmentPlayer.section.leak.test.tsx` (create)

**Interfaces:**
- `AssignmentContent` task type gains `skill_name?: string` (and NOTHING else new — `skill_id`/`power_skill` are NOT forwarded to the client).
- The player shows ONE task at a time. Render the current task's `skill_name` as a heading ONLY when the assignment spans **≥2 distinct skill names** (a single-skill assignment shows no heading — avoids a redundant header on every step).
- `leakGuard.ts` exports `DIAGNOSTIC_VOCAB_RE` + `hasDiagnosticVocab(text)` (the level/verb/band words), reused by the leak test.

- [ ] **Step 1: Add `hasDiagnosticVocab` to `src/lib/copy/leakGuard.ts`** (port the vocabulary from `assignmentResultBundle.ts:21-22` into the shared guard so the player test and any caller share one definition)

```ts
// Diagnostic teacher-only vocabulary that must never reach a student/parent surface.
// (Mirrors assignmentResultBundle's DIAGNOSTIC_VOCAB_RE; this is the shared home.)
export const DIAGNOSTIC_VOCAB_RE =
  /\b(?:reteach|re-teach|reinforce|enrich|scaffolded|extension|partial mastery|strong mastery|(?:top|mid|low|high)-band|\bband\b|above grade level|grade level|on track)\b/i;

export function hasDiagnosticVocab(text: string): boolean {
  return DIAGNOSTIC_VOCAB_RE.test(text);
}
```

(Do NOT change the existing `hasLeak`/`hasBannedWord` behavior — `hasDiagnosticVocab` is additive and called explicitly by the test. `assignmentResultBundle.ts` may optionally import this later; leave it as-is for this task to avoid widening scope.)

- [ ] **Step 2: Write the failing tests**

Extend `loadAssignmentForPlay.test.ts`:

```ts
import { normalizeContent } from '@/lib/assignments/loadAssignmentForPlay';

it('normalizeContent forwards ONLY skill_name (drops skill_id/power_skill) and no level/verb', () => {
  const out = normalizeContent({ tasks: [
    { step: 1, description: 'd', skill_name: 'Fractions', skill_id: 'frac', power_skill: 'Monitor' } as never,
  ] });
  expect(out.tasks![0]).toEqual({ step: 1, description: 'd', type: undefined, skill_name: 'Fractions' });
  expect(Object.keys(out.tasks![0]).sort()).toEqual(['description', 'skill_name', 'step', 'type']);
  expect(JSON.stringify(out)).not.toMatch(/frac|Monitor|scaffolded|extension|Reinforce|Enrich/);
});
```

Create `AssignmentPlayer.section.leak.test.tsx` (jsdom) — a REAL mount, not stubs. Mirror the mounting/advance-to-tasks harness from the sibling `AssignmentPlayer.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { hasDiagnosticVocab } from '@/lib/copy/leakGuard';
import AssignmentPlayer from '@/app/(student)/student/assignments/[id]/play/_components/AssignmentPlayer';

describe('AssignmentPlayer section headings (four-audience)', () => {
  // content.tasks carries two distinct skills; an ADVERSARIAL title/instructions that try
  // to leak a level must still not surface a level/verb in the rendered body.
  const content = {
    title: 'Working with Numbers',
    instructions: 'Try your best on each part.',
    reading_passage: 'Numbers are useful.',
    tasks: [
      { step: 1, description: 'Add these fractions.', skill_name: 'Fractions' },
      { step: 2, description: 'Round these decimals.', skill_name: 'Decimals' },
    ],
  };

  it('renders the skill-name heading for the current task and leaks no level/verb', () => {
    // Mount + advance into the tasks phase exactly as AssignmentPlayer.test.tsx does
    // (e.g. render with content + initialResponses, click "Start"/handleStart).
    // expect(screen.getByTestId('task-skill-heading')).toHaveTextContent('Fractions');
    const body = document.body.textContent ?? '';
    expect(hasDiagnosticVocab(body)).toBe(false); // no scaffolded/extension/Reinforce/Enrich/band/grade level
  });

  it('renders NO heading when the assignment has a single distinct skill', () => {
    // Mount with both tasks skill_name='Fractions' → expect queryByTestId('task-skill-heading') to be null.
  });
});
```

(Fill the mount/advance lines from the sibling test — these assertions are REQUIRED, not optional. The `hasDiagnosticVocab(body)` check over the full rendered DOM is the four-audience regression net.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/assignments/__tests__/loadAssignmentForPlay.test.ts "src/app/(student)/student/assignments/[id]/play/_components/__tests__/AssignmentPlayer.section.leak.test.tsx"`
Expected: FAIL — `skill_name` stripped; no heading; `hasDiagnosticVocab` not exported.

- [ ] **Step 4: Forward `skill_name` (only) through `normalizeContent`** (`loadAssignmentForPlay.ts`)

Update the task type (line 12):

```ts
export type AssignmentContent = { title?: string; instructions?: string; reading_passage?: string; audio_script?: string; tasks?: Array<{ step: number; description: string; type?: string; skill_name?: string }> };
```

Update `normalizeContent` (lines 30-37):

```ts
  const tasks = (c.tasks ?? []).map((t, i) => {
    const tt = t as { step?: number; description?: string; prompt?: string; type?: string; skill_name?: string };
    return {
      step: typeof tt.step === 'number' ? tt.step : i + 1,
      description: tt.description ?? tt.prompt ?? c.instructions ?? '',
      type: tt.type,
      // ONLY the topic name reaches the client. skill_id / power_skill / any level are never forwarded.
      skill_name: typeof tt.skill_name === 'string' && tt.skill_name.trim() ? tt.skill_name : undefined,
    };
  });
```

- [ ] **Step 5: Render the heading** in `AssignmentPlayer.tsx` — compute the distinct-skill gate near the other task derivations (after line 391), then render before `<TaskCard ...>` (line 412):

```tsx
  // Show a topic heading only when the assignment spans 2+ skills (else it's redundant).
  const distinctSkills = new Set(tasks.map((t) => t.skill_name).filter(Boolean));
  const showSkillHeading = distinctSkills.size >= 2;
```

```tsx
        {showSkillHeading && currentTask.skill_name ? (
          <p className="text-fg-muted text-xs font-semibold uppercase tracking-wide" data-testid="task-skill-heading">
            {currentTask.skill_name}
          </p>
        ) : null}
```

(Token classes only. `currentTask`/`tasks` are typed by `AssignmentContent`'s task shape, now carrying `skill_name?`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/copy/__tests__/leakGuard.test.ts src/lib/assignments/__tests__/loadAssignmentForPlay.test.ts "src/app/(student)/student/assignments/[id]/play/_components/__tests__"`
Expected: PASS (new + existing player/leak tests).

- [ ] **Step 7: Append to `STRINGS-FOR-BARB.md`** — exact section:

```markdown
## CL Generation
- On an assignment that spans 2+ skills, the student sees the **skill (topic) name** as a small heading above each section (e.g. "Fractions", "Decimals"). Topic name only — never a difficulty level or a Reinforce/On Track/Enrich verb.
- A single-skill assignment shows no heading (unchanged from today).
```

- [ ] **Step 8: Commit**

```bash
git add "src/lib/copy/leakGuard.ts" "src/lib/assignments/loadAssignmentForPlay.ts" "src/app/(student)/student/assignments/[id]/play/_components/AssignmentPlayer.tsx" "src/lib/assignments/__tests__/loadAssignmentForPlay.test.ts" "src/app/(student)/student/assignments/[id]/play/_components/__tests__/AssignmentPlayer.section.leak.test.tsx" STRINGS-FOR-BARB.md
git commit -m "feat(cl-gen): student section heading by skill name (≥2 skills, leak-guarded)"
```

---

### Task I: Moat per-skill attribution (close the loop)

**Files:**
- Create: `src/lib/skills/perTaskAttribution.ts` (pure)
- Test: `src/lib/skills/__tests__/perTaskAttribution.test.ts`
- Modify: `src/lib/skills/recomputeSkillStates.ts` (queries + homework loop)
- Test: `src/lib/skills/__tests__/recomputeSkillStates.test.ts` (extend)

**Interfaces:**
- Produces: `extractTaskSkillTags(content): { step: number; skill_id: string }[]` and `buildPerSkillHomeworkObs(taskTags, taskGrades, base): Map<string, SkillHomeworkObservation> | null` (ONE averaged observation per skill — see the design note). `base = { submitted: boolean; occurredAt: string; effortLabel: string | null }`, `taskGrades: { step: number; grade: number }[]`. Returns `null` when no usable per-task mapping exists.
- `SkillHomeworkObservation` is `{ gradePct: number | null; submitted: boolean; occurredAt: string; effortLabel: string | null }` (from `./computeSkillState`).

**KEY DESIGN — one averaged observation per skill (NOT one per task).** The old code pushed exactly ONE homework observation per skill per assignment. To keep `observation_count` (and therefore confidence) UNCHANGED while gaining per-skill precision, `buildPerSkillHomeworkObs` returns ONE observation per skill whose `gradePct` is the **average of that skill's tagged task grades** (rounded). So a strong-fractions / weak-decimals assignment yields `{ frac: avg(high), dec: avg(low) }` — precise per skill, with no observation-count inflation.

**No-data-loss rule.** For every skill in `a.skill_ids`, push `perSkill.get(skillId)` if present, ELSE the assignment-level observation. A skill in `skill_ids` that no tagged task covered still gets the assignment-level grade — never dropped.

**Override-wins.** When the graded attempt has a teacher override (`teacher_score` is a number), skip per-skill attribution entirely and use the assignment-level observation (the override grade) for every skill.

**Spark is UNTOUCHED.** The SPARK completions → per-skill block (current lines 303-337) keeps its assignment-level fan-out. This task changes ONLY the homework loop.

- [ ] **Step 1: Write the failing test** — `src/lib/skills/__tests__/perTaskAttribution.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { extractTaskSkillTags, buildPerSkillHomeworkObs } from '@/lib/skills/perTaskAttribution';

describe('extractTaskSkillTags', () => {
  it('pulls (step, skill_id) for tagged tasks, ignoring untagged', () => {
    const out = extractTaskSkillTags({ tasks: [
      { step: 1, skill_id: 'frac' }, { step: 2, skill_id: 'dec' }, { step: 3, skill_id: null }, { step: 4 },
    ] });
    expect(out).toEqual([{ step: 1, skill_id: 'frac' }, { step: 2, skill_id: 'dec' }]);
  });
  it('returns [] for null/untagged content', () => {
    expect(extractTaskSkillTags(null)).toEqual([]);
    expect(extractTaskSkillTags({ tasks: [{ step: 1, description: 'd' } as never] })).toEqual([]);
  });
});

describe('buildPerSkillHomeworkObs', () => {
  const base = { submitted: true, occurredAt: '2026-06-26', effortLabel: 'independent_success' };
  it('produces ONE averaged observation per skill (no inflation)', () => {
    const m = buildPerSkillHomeworkObs(
      [{ step: 1, skill_id: 'frac' }, { step: 2, skill_id: 'frac' }, { step: 3, skill_id: 'dec' }],
      [{ step: 1, grade: 90 }, { step: 2, grade: 80 }, { step: 3, grade: 40 }],
      base,
    )!;
    expect(m.get('frac')).toMatchObject({ gradePct: 85, submitted: true, effortLabel: 'independent_success' }); // avg(90,80)
    expect(m.get('dec')).toMatchObject({ gradePct: 40 });
    expect(m.get('frac') && Array.isArray(m.get('frac'))).toBe(false); // single obs, not an array
  });
  it('returns null when there are no tags or no grades (caller falls back)', () => {
    expect(buildPerSkillHomeworkObs([], [{ step: 1, grade: 90 }], base)).toBeNull();
    expect(buildPerSkillHomeworkObs([{ step: 1, skill_id: 'frac' }], [], base)).toBeNull();
  });
  it('omits a skill whose tagged task has no matching grade (caller fan-out covers it)', () => {
    const m = buildPerSkillHomeworkObs([{ step: 1, skill_id: 'frac' }, { step: 2, skill_id: 'dec' }], [{ step: 1, grade: 70 }], base)!;
    expect(m.get('frac')).toMatchObject({ gradePct: 70 });
    expect(m.has('dec')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/skills/__tests__/perTaskAttribution.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/skills/perTaskAttribution.ts`**

```ts
// src/lib/skills/perTaskAttribution.ts
// Pure helpers for CL → generation's "close the loop": attribute a graded assignment to
// its skills PER SKILL (one averaged observation each) so a per-skill assignment updates
// per-skill Comprehension Level precisely — WITHOUT inflating observation_count (still one
// observation per skill per assignment, matching the legacy assignment-level behavior).
import type { SkillHomeworkObservation } from './computeSkillState';

type Content = { tasks?: Array<{ step?: number; skill_id?: string | null }> } | null | undefined;

/** Pull (step, skill_id) for every task that carries a non-null skill_id. */
export function extractTaskSkillTags(content: Content): { step: number; skill_id: string }[] {
  const tasks = content?.tasks ?? [];
  const out: { step: number; skill_id: string }[] = [];
  for (const t of tasks) {
    if (typeof t?.step === 'number' && typeof t?.skill_id === 'string' && t.skill_id) {
      out.push({ step: t.step, skill_id: t.skill_id });
    }
  }
  return out;
}

/**
 * Build ONE averaged homework observation per skill from per-task skill tags + per-task
 * grades. gradePct = round(mean of that skill's tagged task grades). Returns null when
 * there is nothing to attribute (no tags or no grades) — the caller then uses the
 * assignment-level observation for every skill.
 */
export function buildPerSkillHomeworkObs(
  taskTags: { step: number; skill_id: string }[],
  taskGrades: { step: number; grade: number }[],
  base: { submitted: boolean; occurredAt: string; effortLabel: string | null },
): Map<string, SkillHomeworkObservation> | null {
  if (taskTags.length === 0 || taskGrades.length === 0) return null;
  const gradeByStep = new Map(taskGrades.map((g) => [g.step, g.grade]));
  const gradesBySkill = new Map<string, number[]>();
  for (const tag of taskTags) {
    if (!gradeByStep.has(tag.step)) continue; // tagged task without a grade → skip
    if (!gradesBySkill.has(tag.skill_id)) gradesBySkill.set(tag.skill_id, []);
    gradesBySkill.get(tag.skill_id)!.push(gradeByStep.get(tag.step)!);
  }
  if (gradesBySkill.size === 0) return null;
  const out = new Map<string, SkillHomeworkObservation>();
  for (const [skillId, grades] of gradesBySkill) {
    const avg = Math.round(grades.reduce((a, b) => a + b, 0) / grades.length);
    out.set(skillId, { gradePct: avg, submitted: base.submitted, occurredAt: base.occurredAt, effortLabel: base.effortLabel });
  }
  return out;
}
```

- [ ] **Step 4: Run the pure tests to verify they pass**

Run: `npx vitest run src/lib/skills/__tests__/perTaskAttribution.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire per-skill attribution into `recomputeSkillStates.ts`**

Add the import:

```ts
import { extractTaskSkillTags, buildPerSkillHomeworkObs } from './perTaskAttribution';
```

Widen `AssignmentRow` (lines 63-69) to include `content`:

```ts
interface AssignmentRow {
  id: string;
  skill_ids: string[] | null;
  reteach_needed: boolean | null;
  created_at: string;
  content: { tasks?: Array<{ step?: number; skill_id?: string | null }> } | null; // CL → gen per-task tags
}
```

Add `content` to the assignments select (line 178). (Selecting the full `content` jsonb is the SAFE choice; a `content->tasks` JSONB-path narrowing is a deferred perf optimization — do NOT risk a PostgREST aliasing quirk silently degrading attribution on the moat pipeline.)

```ts
      .select('id, skill_ids, reteach_needed, created_at, content')
```

Widen `HwAttemptRow` (lines 71-84) to include `task_grades`:

```ts
  task_grades: Array<{ step: number; grade: number }> | null; // 0011 — per-task AI grades
```

Add `task_grades` to the homework_attempts select (line 202):

```ts
          'assignment_id, student_id, status, score_pct, teacher_score, ' +
          'effort_label, allow_redo, is_redo, flagged_by, submitted_at, graded_at, task_grades',
```

In the homework loop, REPLACE the old `gradePct`/`obs` construction + the combined `for (const skillId of a.skill_ids!)` block (current lines 248-300) with the following. (The `graded`/`submitted` finds at 235-246 stay; the SPARK block at 303-337 is untouched.)

```ts
      const occurredAt = graded?.graded_at ?? graded?.submitted_at ?? a.created_at;
      const effortLabel = graded?.effort_label ?? null;

      // Override wins: a teacher-overridden grade is authoritative → assignment-level fan-out.
      const hasOverride = graded != null && typeof graded.teacher_score === 'number';
      const assignmentGradePct = graded
        ? (typeof graded.teacher_score === 'number' ? graded.teacher_score : graded.score_pct ?? null)
        : null;
      const assignmentObs: SkillHomeworkObservation = { gradePct: assignmentGradePct, submitted, occurredAt, effortLabel };

      // CL → generation: ONE averaged observation per skill from per-task tags (no
      // observation-count inflation), unless overridden. A skill not covered by any
      // tagged task falls back to the assignment-level observation (never dropped).
      const perSkill = hasOverride
        ? null
        : buildPerSkillHomeworkObs(
            extractTaskSkillTags(a.content),
            (graded?.task_grades ?? []) as { step: number; grade: number }[],
            { submitted, occurredAt, effortLabel },
          );

      for (const skillId of a.skill_ids!) {
        const obs = perSkill?.get(skillId) ?? assignmentObs;
        if (!hwBySkill.has(skillId)) hwBySkill.set(skillId, []);
        hwBySkill.get(skillId)!.push(obs);
      }

      // ── reteach (UNCHANGED — stays assignment-level) ──
      const redoAttempt = attempts.find(
        (h) => h.is_redo === true && (h.status === 'graded' || h.submitted_at != null),
      );
      let reteach: SkillReteachEvent | null = null;
      if (redoAttempt && (redoAttempt.submitted_at ?? redoAttempt.graded_at)) {
        const completedAt = redoAttempt.graded_at ?? redoAttempt.submitted_at!;
        const isDifferentApproach = a.reteach_needed === true || redoAttempt.flagged_by === 'reteach';
        reteach = { type: isDifferentApproach ? 'different_approach' : 'more_practice', completedAt };
      }
      for (const skillId of a.skill_ids!) {
        if (reteach) {
          const prev = reteachBySkill.get(skillId);
          if (!prev || prev.completedAt < reteach.completedAt) reteachBySkill.set(skillId, reteach);
        }
      }
```

- [ ] **Step 6: Extend the moat test** — `src/lib/skills/__tests__/recomputeSkillStates.test.ts` (mirror the file's admin mock harness; spy `computeSkillState` via `vi.mock('@/lib/skills/computeSkillState')` to capture the `SkillStateInput.homework` per skill, OR assert on the upsert payload).

**Required assertions:**

```ts
it('attributes per-skill averaged grades to the right skill when tagged (no override)', async () => {
  // assignment: content.tasks=[{step:1,skill_id:'frac'},{step:2,skill_id:'dec'}], skill_ids=['frac','dec'];
  // graded hw: teacher_score=null, task_grades=[{step:1,grade:90},{step:2,grade:40}].
  // Assert the homework input for 'frac' has gradePct 90 and for 'dec' has gradePct 40
  // (DIFFERENT grades — not the same fanned value), and each skill got exactly ONE homework obs.
});

it('falls back to assignment-level fan-out when the teacher overrode the grade', async () => {
  // Same seed but teacher_score=85 → both 'frac' and 'dec' homework obs gradePct === 85.
});

it('does not drop a skill_ids skill that no tagged task covered', async () => {
  // content.tasks=[{step:1,skill_id:'frac'}] but skill_ids=['frac','dec']; task_grades=[{step:1,grade:90}].
  // Assert 'frac' gets 90 (per-skill) and 'dec' STILL gets the assignment-level obs (not dropped, not empty).
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/skills/__tests__/perTaskAttribution.test.ts src/lib/skills/__tests__/recomputeSkillStates.test.ts`
Expected: PASS (new + all existing recompute cases).

- [ ] **Step 8: Commit**

```bash
git add src/lib/skills/perTaskAttribution.ts src/lib/skills/__tests__/perTaskAttribution.test.ts src/lib/skills/recomputeSkillStates.ts src/lib/skills/__tests__/recomputeSkillStates.test.ts
git commit -m "feat(cl-gen): per-skill averaged attribution closes the CL loop (no inflation, override-wins, no drops)"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `npm test` → full suite green (no regressions)
- [ ] `npm run build` → 0 (a11y contrast + token sync pass)
- [ ] Manual sanity: a tagged multi-skill lesson produces a sectioned assignment; the student player shows skill-name headings and never a level/verb; `assignments.skill_ids` is populated; a graded per-skill assignment moves only the weak skill's CL.

## Spec coverage self-check
- Per-skill sectioned generation → Tasks A/B/C/E/F/G. Power skill in every task → Tasks D/E. Flat step-keyed invariant → preserved (no schema re-key; tasks stay a flat array). Confidence gate + cap → Tasks A/B. skill_ids populated → Tasks F/G. Student heading (skill name only) + leak guard → Task H. Close-the-loop per-task attribution + override-wins → Task I. No migration → none added. Backward compat → Tasks E/F/G (empty targets → today's path) + Task D (optional fields).
