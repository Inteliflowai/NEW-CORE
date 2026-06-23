# Content Studio Segment 2 — AI Lesson Generator + URL Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-purpose Upload page into a three-tab **Content Studio** (Upload a file · From a URL · Generate with AI) where a teacher can type a description and get a full, standards-aware lesson (single day or a multi-day unit) to review/edit, then a quiz — reusing the existing parse→quiz pipeline end to end.

**Architecture:** Two new import-safe engine functions (`generateLesson`, `segmentUnit`) and a URL text extractor (`extractTextFromUrl`) mirror the existing `parseLesson` pattern exactly (OPENAI_GEN_MODEL · `json_object` · throw `LlmExhaustedError`). They reuse the existing `ParsedLessonSchema` output contract so the existing `generateQuiz` path is unchanged. Three routes (`POST /lessons/generate`, extended `POST /lessons/manage` with an `edit` action, `POST /lessons/import-url`) wrap them with the standard teacher auth chain. The UI restructures `/upload` into an ARIA tablist; the URL tab reuses the Upload chain (parse → fuzzy-dup gate → quiz); the Generate tab feeds a new editable review surface (forked from the read-only `LessonViewPanel`) that confirms AI-proposed US-state standards, then makes quizzes per day. Migration 0020 adds `lessons.chapter_title`, `lessons.day_index`, `lessons.standard_codes`, `lessons.standard_framework`, and `schools.state`.

**Tech Stack:** Next.js 16 App Router (async `searchParams`), React 19, TypeScript, Tailwind v4 (token-only), Zod 4, Vitest 4 (+ jsdom/RTL for components), OpenAI via `resilientChatCompletion`.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from CLAUDE.md / the Content Studio spec / grounding.

- **Auth chain on every teacher route (exact):** `await createServerSupabaseClient()` → `auth.getUser()` (401 if absent) → role gate against `TEACHER_ROLES`/`STAFF_ROLES` = `['teacher','school_admin','school_sysadmin','platform_admin']` (403) → `createAdminSupabaseClient()` (synchronous; bypasses RLS) → `guardClassAccess(classId)` — **the ONLY IDOR backstop**; if it returns a value, return it. Mirror the sibling route exactly (`src/app/api/teacher/lessons/parse/route.ts`, `…/quizzes/generate/route.ts`, `…/lessons/manage/route.ts`).
- **Engine purity:** files under `src/lib/engine/` and `src/lib/standards/` MUST NOT import `next/*` or Supabase. Pure async functions only.
- **Calibration-frozen model:** all content generation uses `OPENAI_GEN_MODEL` (`src/lib/ai/models.ts`; defaults to `gpt-4o`). Do NOT introduce a different model. Do NOT pass a `temperature` to Claude paths (not used here).
- **Engine error contract:** on null completion or `ZodError`, throw `LlmExhaustedError('openai', cause?)` (`src/lib/ai/errors.ts`). Routes catch and return `respondEngineError(err)` (`src/app/api/_lib/errorEnvelope.ts`) — `LlmExhaustedError` → 503 retryable; other → 500. **Never return HTTP 200 on a silent Supabase write error** — capture `.error` and fail loud.
- **Four-audience leak discipline:** teacher-only surface — "likely misconceptions"/standards are fine here; NO band enum / risk number / signals anywhere. Run user-facing prose past `src/lib/copy/leakGuard.ts` conventions; digits at their own render site only.
- **"Assignments", never "Homework"** in any UI/copy.
- **Tokens:** Tailwind v4 token classes only — no hardcoded hex, no arbitrary `[var(--..)]`. Pop-art chrome: `border-2 border-sidebar-edge`, `shadow-sticker`/`shadow-sticker-lg`, `SectionLabel`, teacher brand = cobalt, accent = lime. Content text is deep-ink `text-fg` (not `text-fg-muted`). **Do not invent a token** — if one seems needed, stop and ask. Existing arbitrary `text-[10px]`/`tracking-[…]` values are an accepted app-wide convention (separate token pass) — do not add NEW ones.
- **WCAG-AA:** `npm run a11y` gate must pass. Visible keyboard focus (`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`), `role="dialog"`+focus-trap+Escape for panels (mirror `LessonViewPanel`/`DupModal`), `prefers-reduced-motion` respected.
- **Strings → Barb:** every new user-facing string is a DRAFT; add it to `STRINGS-FOR-BARB.md §Content Studio`.
- **TDD:** test first, watch it fail, minimal code, commit per step. Component tests start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`. Engine tests mock `@/lib/ai/openai`'s `resilientChatCompletion`; route tests mock `@/lib/supabase/server` + `@/lib/auth/guards` + `@/lib/auth/roles` and use `vi.resetModules()` + dynamic import.
- **Migration:** file `supabase/migrations/0020_<desc>.sql`, additive, every statement idempotent (`add column if not exists`, `create index if not exists`). The migration FILE is written here; **applying it to the live NEW CORE DB (`pmdzxwppdlnddtnkoarc`) is Marvin's explicit call** — do not run DDL against production.
- **Gates before merge:** `npx tsc --noEmit` 0 errors · `npm test` all green · `npm run build` 0 · `npm run a11y` pass · `npm run tokens:check` in sync.

---

## File Structure

**New files**
- `src/lib/standards/frameworks.ts` — US state → standards framework label + prompt guidance + `US_STATES` list. Pure.
- `src/lib/standards/__tests__/frameworks.test.ts`
- `src/lib/engine/lessonGenerate.ts` — `generateLesson`, `segmentUnit`, `resolveNumDays`, `MAX_GENERATE_DAYS`. Pure.
- `src/lib/engine/__tests__/lessonGenerate.test.ts`
- `src/lib/engine/parseUrl.ts` — `extractTextFromUrl`, `stripHtml`, `UrlFetchError`. Pure.
- `src/lib/engine/__tests__/parseUrl.test.ts`
- `src/app/api/teacher/lessons/generate/route.ts` + `__tests__/route.test.ts`
- `src/app/api/teacher/lessons/import-url/route.ts` + `__tests__/route.test.ts`
- `src/app/(teacher)/upload/_components/DupModal.tsx` — extracted shared modal (from UploadStudio).
- `src/app/(teacher)/upload/_components/ContentStudioTabs.tsx` + test — the 3-tab hub.
- `src/app/(teacher)/upload/_components/UrlImportStudio.tsx` + test — "From a URL" tab.
- `src/app/(teacher)/upload/_components/GenerateLessonStudio.tsx` + test — "Generate with AI" tab.
- `src/app/(teacher)/upload/_components/LessonReviewEditor.tsx` + test — editable review of generated lesson(s) + standards confirm + make quizzes.
- `supabase/migrations/0020_content_studio_generate.sql`

**Modified files**
- `src/lib/engine/types.ts` — add `ProposedStandardSchema`, `GeneratedLessonSchema`/`GeneratedLesson`, `UnitSegmentSchema`/`UnitSegmentsSchema`/`UnitSegment`.
- `src/lib/openai/prompts.ts` — add `LESSON_GENERATE_SYSTEM`, `lessonGeneratePrompt`, `UNIT_SEGMENT_SYSTEM`, `unitSegmentPrompt`.
- `src/app/api/teacher/lessons/manage/route.ts` — add `'edit'` action.
- `src/app/api/teacher/lessons/manage/__tests__/route.test.ts` — cover `'edit'`.
- `src/app/(teacher)/upload/_components/UploadStudio.tsx` — import shared `DupModal` (remove the inline copy).
- `src/app/(teacher)/upload/page.tsx` — fetch school state + render `ContentStudioTabs` instead of `UploadStudio` directly; update `PageHeader`.
- `STRINGS-FOR-BARB.md` — §Content Studio additions.

**Dependency waves**
- **Wave A (parallel):** Task 1 (migration), Task 2 (standards).
- **Wave B (parallel, after types edit in Task 3a):** Task 3 (generateLesson+segmentUnit+prompts+types), Task 4 (parseUrl). Task 3 owns the `types.ts` edit.
- **Wave C (after B + A):** Task 5 (generate route), Task 6 (manage edit), Task 7 (import-url route).
- **Wave D (after C), built in dependency order:** Task 8 (LessonReviewEditor) → Task 9 (GenerateLessonStudio, renders the editor) → Task 10 (DupModal extract + UrlImportStudio) → Task 11 (ContentStudioTabs hub, imports all three tab components) → Task 12 (page wiring). Per the propose-only UI discipline, each component is built then **previewed via Playwright for Marvin before any proposed visual change is applied**.
- **Wave E:** Task 13 (strings + gates).

---

### Task 1: Migration 0020 — schema for units, standards, and school state

**Files:**
- Create: `supabase/migrations/0020_content_studio_generate.sql`
- Test: `src/lib/engine/__tests__/migration0020.test.ts` (string assertions on the SQL file — mirrors the existing `migration0010.test.ts` convention)

**Interfaces:**
- Produces (DB columns later tasks rely on): `lessons.chapter_title text`, `lessons.day_index int`, `lessons.standard_codes text[] default '{}'`, `lessons.standard_framework text`, `schools.state text`. `lessons.source` is free-text (no CHECK in V2) — `'generate'`/`'url'` need no constraint change.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/engine/__tests__/migration0020.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/0020_content_studio_generate.sql'),
  'utf-8',
);

describe('migration 0020', () => {
  it('adds the multi-day + standards columns to lessons (idempotent)', () => {
    expect(sql).toMatch(/alter table public\.lessons/i);
    expect(sql).toMatch(/add column if not exists chapter_title\s+text/i);
    expect(sql).toMatch(/add column if not exists day_index\s+int/i);
    expect(sql).toMatch(/add column if not exists standard_codes\s+text\[\]\s+default '\{\}'/i);
    expect(sql).toMatch(/add column if not exists standard_framework\s+text/i);
  });
  it('adds schools.state (idempotent)', () => {
    expect(sql).toMatch(/alter table public\.schools/i);
    expect(sql).toMatch(/add column if not exists state\s+text/i);
  });
  it('indexes the unit grouping key', () => {
    expect(sql).toMatch(/create index if not exists lessons_class_chapter_idx/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engine/__tests__/migration0020.test.ts`
Expected: FAIL — file does not exist (ENOENT).

- [ ] **Step 3: Write the migration**

```sql
-- 0020_content_studio_generate.sql
-- Content Studio Seg 2: AI Lesson Generator + URL import.
-- Multi-day units (chapter_title + day_index), teacher-confirmed standards
-- (standard_codes + standard_framework), and the school's US state (drives the
-- standards-aware proposal). All additive + idempotent. lessons.source is free-text
-- in V2, so source='generate' / 'url' need no CHECK change.
alter table public.lessons
  add column if not exists chapter_title      text,
  add column if not exists day_index          int,
  add column if not exists standard_codes     text[] default '{}',
  add column if not exists standard_framework text;

-- A multi-day unit is grouped by (teacher_id, class_id, chapter_title); index the class+chapter lookup.
create index if not exists lessons_class_chapter_idx
  on public.lessons (class_id, chapter_title);

-- The school's 2-letter US state code (nullable). Populated manually/at provisioning later;
-- when null the generator's standards step degrades to optional (teacher picks inline).
alter table public.schools
  add column if not exists state text;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/engine/__tests__/migration0020.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0020_content_studio_generate.sql src/lib/engine/__tests__/migration0020.test.ts
git commit -m "feat(content-studio): migration 0020 — unit + standards columns + schools.state"
```

---

### Task 2: Standards framework lookup (US state → framework label + prompt guidance)

**Files:**
- Create: `src/lib/standards/frameworks.ts`
- Test: `src/lib/standards/__tests__/frameworks.test.ts`

**Interfaces:**
- Produces: `US_STATES: StateOption[]` (`{code,name}`, 50 states + DC); `isUsStateCode(v): v is string`; `frameworkLabelForState(state): string`; `standardsGuidance(state): string`. Consumed by Task 3 (prompt), Task 5 (route resolves framework), Task 10 (state picker).
- This is NOT a curated standards database (that's a future epic) — only a label + prompt-guidance lookup. The model proposes codes; the teacher confirms.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/standards/__tests__/frameworks.test.ts
import { describe, it, expect } from 'vitest';
import {
  US_STATES, isUsStateCode, frameworkLabelForState, standardsGuidance,
} from '@/lib/standards/frameworks';

describe('standards/frameworks', () => {
  it('lists 50 states + DC, each with a 2-letter code', () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES.every((s) => /^[A-Z]{2}$/.test(s.code))).toBe(true);
    expect(US_STATES.find((s) => s.code === 'TX')?.name).toBe('Texas');
  });
  it('isUsStateCode is case-insensitive and rejects junk', () => {
    expect(isUsStateCode('ca')).toBe(true);
    expect(isUsStateCode('CA')).toBe(true);
    expect(isUsStateCode('ZZ')).toBe(false);
    expect(isUsStateCode(null)).toBe(false);
    expect(isUsStateCode('')).toBe(false);
  });
  it('maps named-standard states to their framework, others to Common Core + NGSS', () => {
    expect(frameworkLabelForState('TX')).toMatch(/TEKS/);
    expect(frameworkLabelForState('FL')).toMatch(/B\.E\.S\.T/);
    expect(frameworkLabelForState('VA')).toMatch(/SOL|Standards of Learning/);
    expect(frameworkLabelForState('CA')).toMatch(/Common Core/);
    expect(frameworkLabelForState(null)).toMatch(/Common Core/); // national reference fallback
  });
  it('standardsGuidance names the state when known and stays generic when not', () => {
    expect(standardsGuidance('TX')).toMatch(/Texas|TX/);
    expect(standardsGuidance('TX')).toMatch(/propose/i);
    expect(standardsGuidance(null)).toMatch(/generally|US K-12/i);
    expect(standardsGuidance(null)).not.toMatch(/\bnull\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/standards/__tests__/frameworks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/standards/frameworks.ts
// US state → standards framework, for the AI lesson generator's PROPOSE step.
// NOT a curated standards database (separate epic) — a lightweight label + prompt guidance.
// The model proposes codes; the teacher confirms. Pure (no next/Supabase imports).

export interface StateOption {
  code: string;
  name: string;
}

export const US_STATES: StateOption[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

const STATE_CODES = new Set(US_STATES.map((s) => s.code));

export function isUsStateCode(v: string | null | undefined): v is string {
  return typeof v === 'string' && STATE_CODES.has(v.toUpperCase());
}

// States that primarily use their own named standards rather than Common Core / NGSS.
const NAMED_STATE_FRAMEWORKS: Record<string, string> = {
  TX: 'the Texas Essential Knowledge and Skills (TEKS)',
  FL: 'the Florida B.E.S.T. Standards',
  VA: 'the Virginia Standards of Learning (SOL)',
};

const DEFAULT_FRAMEWORK =
  'the Common Core State Standards (ELA & Math) and the Next Generation Science Standards (NGSS)';

/** Framework label for a state. Unknown/null → the national reference set. */
export function frameworkLabelForState(state: string | null | undefined): string {
  if (isUsStateCode(state)) return NAMED_STATE_FRAMEWORKS[state.toUpperCase()] ?? DEFAULT_FRAMEWORK;
  return DEFAULT_FRAMEWORK;
}

/** A prompt directive telling the model which standards to align to and to propose codes from. */
export function standardsGuidance(state: string | null | undefined): string {
  const label = frameworkLabelForState(state);
  const where = isUsStateCode(state)
    ? `the US state of ${state.toUpperCase()}`
    : 'US K-12 schools generally';
  return (
    `Align this lesson to ${label}, used in ${where}. ` +
    'Propose 1-4 specific standard codes this lesson addresses, each with a short plain-language ' +
    'description, in a "proposed_standards" array. If you are not confident a specific code applies, ' +
    'propose fewer codes rather than inventing any.'
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/standards/__tests__/frameworks.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/standards/
git commit -m "feat(content-studio): US state → standards framework lookup"
```

---

### Task 3: Engine — `generateLesson` + `segmentUnit` (+ schemas + prompts)

**Files:**
- Modify: `src/lib/engine/types.ts` (add schemas at the end, before/after existing exports)
- Modify: `src/lib/openai/prompts.ts` (add the four exports)
- Create: `src/lib/engine/lessonGenerate.ts`
- Test: `src/lib/engine/__tests__/lessonGenerate.test.ts`

**Interfaces:**
- Consumes: `resilientChatCompletion` (`@/lib/ai/openai`), `OPENAI_GEN_MODEL` (`@/lib/ai/models`), `LlmExhaustedError` (`@/lib/ai/errors`), `ParsedLessonSchema` (`@/lib/engine/types`).
- Produces:
  - `ProposedStandardSchema = z.object({ code: string, description: string })`
  - `GeneratedLessonSchema = ParsedLessonSchema.extend({ proposed_standards: z.array(ProposedStandardSchema).default([]) })`; `type GeneratedLesson`
  - `UnitSegmentSchema = z.object({ day: int, title: string, focus: string })`; `UnitSegmentsSchema = z.object({ unit_title: string, days: z.array(UnitSegmentSchema).min(1) })`; `type UnitSegment`
  - `generateLesson(input: GenerateLessonInput): Promise<GeneratedLesson>` where `GenerateLessonInput = { description: string; subject?: string|null; grade_level?: string|null; focus?: string|null; standardsGuidance?: string|null }`
  - `segmentUnit(input: { description: string; numDays: number; subject?: string|null; grade_level?: string|null }): Promise<{ unit_title: string; days: UnitSegment[] }>`
  - `resolveNumDays(raw: unknown): number` (returns 1 for non-int/<2; caps at `MAX_GENERATE_DAYS = 10`)
  - `LESSON_GENERATE_SYSTEM`, `lessonGeneratePrompt(input)`, `UNIT_SEGMENT_SYSTEM`, `unitSegmentPrompt(input)` in `prompts.ts`

- [ ] **Step 1: Add schemas to `src/lib/engine/types.ts`** (append after the existing `ParsedLesson` export region)

```ts
// ── #6 Lesson generate (Seg 2) — reuses the parse contract + AI-proposed standards ──
export const ProposedStandardSchema = z.object({
  code: z.string(),
  description: z.string(),
});
export type ProposedStandard = z.infer<typeof ProposedStandardSchema>;

export const GeneratedLessonSchema = ParsedLessonSchema.extend({
  proposed_standards: z.array(ProposedStandardSchema).default([]),
});
export type GeneratedLesson = z.infer<typeof GeneratedLessonSchema>;

// ── #7 Unit segmentation (Seg 2 multi-day) ──
export const UnitSegmentSchema = z.object({
  day: z.number().int(),
  title: z.string(),
  focus: z.string(),
});
export type UnitSegment = z.infer<typeof UnitSegmentSchema>;

export const UnitSegmentsSchema = z.object({
  unit_title: z.string(),
  days: z.array(UnitSegmentSchema).min(1),
});
export type UnitSegments = z.infer<typeof UnitSegmentsSchema>;
```

- [ ] **Step 2: Add prompts to `src/lib/openai/prompts.ts`** (mirror the `LESSON_PARSE_SYSTEM` + `lessonParsePrompt` pattern: a SYSTEM const + a prompt-builder function)

```ts
export const LESSON_GENERATE_SYSTEM =
  'You are an expert K-12 curriculum designer. Write one complete, classroom-ready lesson from ' +
  "the teacher's description. Return ONLY valid JSON. No markdown, no explanation, no preamble.";

export function lessonGeneratePrompt(input: {
  description: string;
  subject?: string | null;
  grade_level?: string | null;
  focus?: string | null;
  standardsGuidance?: string | null;
}): string {
  const hints = [
    input.subject ? `Subject: ${input.subject}.` : '',
    input.grade_level ? `Grade level: ${input.grade_level}.` : '',
    input.focus ? `This lesson is one day of a larger unit. Focus it on: ${input.focus}` : '',
  ].filter(Boolean).join(' ');

  return [
    `Write a lesson for this description:\n"""${input.description}"""`,
    hints,
    input.standardsGuidance ?? '',
    'Return a JSON object with these fields:',
    '- "title": a short lesson title.',
    '- "summary": a 200-400 word teaching passage written for the stated grade level (the core reading the teacher would deliver).',
    '- "objectives": 2-5 measurable learning objectives.',
    '- "key_concepts": 4-8 key concepts (short phrases).',
    '- "vocabulary": 5-10 items, each {"term","definition"}.',
    '- "misconception_risks": 2-4 likely student misconceptions.',
    '- "grade_level": the grade level (echo the hint if given, else infer).',
    '- "subject": the subject (echo the hint if given, else infer).',
    '- "proposed_standards": an array of {"code","description"} (may be empty).',
    'Write plain, grade-appropriate language. Do not reference external materials not included in the summary.',
  ].filter(Boolean).join('\n');
}

export const UNIT_SEGMENT_SYSTEM =
  'You are an expert curriculum planner. Split a multi-day unit into a coherent day-by-day ' +
  'sequence. Return ONLY valid JSON. No markdown, no preamble.';

export function unitSegmentPrompt(input: {
  description: string;
  numDays: number;
  subject?: string | null;
  grade_level?: string | null;
}): string {
  const hints = [
    input.subject ? `Subject: ${input.subject}.` : '',
    input.grade_level ? `Grade level: ${input.grade_level}.` : '',
  ].filter(Boolean).join(' ');
  return [
    `Split this unit into EXACTLY ${input.numDays} days:\n"""${input.description}"""`,
    hints,
    'Return a JSON object: {"unit_title": string, "days": [{"day": number, "title": string, "focus": string}]}.',
    `The "days" array MUST have exactly ${input.numDays} entries, numbered 1..${input.numDays}.`,
    'Each "focus" is 1-2 sentences specific enough to write a full lesson from. Order days so they build on each other.',
  ].filter(Boolean).join('\n');
}
```

- [ ] **Step 3: Write the failing test**

```ts
// src/lib/engine/__tests__/lessonGenerate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';

const mockChat = vi.fn();
vi.mock('@/lib/ai/openai', () => ({ resilientChatCompletion: (...a: unknown[]) => mockChat(...a) }));

function completion(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

describe('lessonGenerate', () => {
  beforeEach(() => mockChat.mockReset());

  it('resolveNumDays: <2 / non-int → 1; caps at 10', async () => {
    const { resolveNumDays, MAX_GENERATE_DAYS } = await import('@/lib/engine/lessonGenerate');
    expect(resolveNumDays(1)).toBe(1);
    expect(resolveNumDays(0)).toBe(1);
    expect(resolveNumDays(2.5)).toBe(1);
    expect(resolveNumDays('x')).toBe(1);
    expect(resolveNumDays(3)).toBe(3);
    expect(resolveNumDays(99)).toBe(MAX_GENERATE_DAYS);
  });

  it('generateLesson returns a validated lesson with proposed_standards default', async () => {
    mockChat.mockResolvedValue(completion({
      title: 'Fractions', summary: 'A passage about fractions…',
      objectives: ['Add fractions'], key_concepts: ['numerator', 'denominator'],
      vocabulary: [{ term: 'fraction', definition: 'part of a whole' }],
      misconception_risks: ['bigger denominator = bigger number'],
      grade_level: '4', subject: 'Math',
      proposed_standards: [{ code: 'CCSS.MATH.4.NF.A.1', description: 'Equivalent fractions' }],
    }));
    const { generateLesson } = await import('@/lib/engine/lessonGenerate');
    const out = await generateLesson({ description: 'Teach adding fractions' });
    expect(out.title).toBe('Fractions');
    expect(out.proposed_standards[0].code).toMatch(/4\.NF/);
  });

  it('generateLesson defaults proposed_standards to [] when omitted', async () => {
    mockChat.mockResolvedValue(completion({ title: 'X', summary: 's' }));
    const { generateLesson } = await import('@/lib/engine/lessonGenerate');
    const out = await generateLesson({ description: 'x' });
    expect(out.proposed_standards).toEqual([]);
  });

  it('generateLesson throws LlmExhaustedError on null completion', async () => {
    mockChat.mockResolvedValue(null);
    const { generateLesson } = await import('@/lib/engine/lessonGenerate');
    await expect(generateLesson({ description: 'x' })).rejects.toBeInstanceOf(LlmExhaustedError);
  });

  it('generateLesson re-throws malformed JSON shape as LlmExhaustedError', async () => {
    mockChat.mockResolvedValue({ choices: [{ message: { content: '[1,2,3]' } }] });
    const { generateLesson } = await import('@/lib/engine/lessonGenerate');
    await expect(generateLesson({ description: 'x' })).rejects.toBeInstanceOf(LlmExhaustedError);
  });

  it('generateLesson rejects an empty description before calling the LLM', async () => {
    const { generateLesson } = await import('@/lib/engine/lessonGenerate');
    await expect(generateLesson({ description: '   ' })).rejects.toThrow();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('segmentUnit returns unit_title + days', async () => {
    mockChat.mockResolvedValue(completion({
      unit_title: 'Ecosystems', days: [
        { day: 1, title: 'Producers', focus: 'Plants make energy.' },
        { day: 2, title: 'Consumers', focus: 'Animals eat.' },
      ],
    }));
    const { segmentUnit } = await import('@/lib/engine/lessonGenerate');
    const out = await segmentUnit({ description: 'Ecosystems unit', numDays: 2 });
    expect(out.unit_title).toBe('Ecosystems');
    expect(out.days).toHaveLength(2);
    expect(out.days[1].focus).toMatch(/eat/);
  });

  it('segmentUnit throws LlmExhaustedError on malformed output', async () => {
    mockChat.mockResolvedValue(completion({ unit_title: 'x' })); // missing days[]
    const { segmentUnit } = await import('@/lib/engine/lessonGenerate');
    await expect(segmentUnit({ description: 'x', numDays: 2 })).rejects.toBeInstanceOf(LlmExhaustedError);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/engine/__tests__/lessonGenerate.test.ts`
Expected: FAIL — `@/lib/engine/lessonGenerate` not found.

- [ ] **Step 5: Write the implementation**

```ts
// src/lib/engine/lessonGenerate.ts
// Engine (import-safe): AI lesson generation + multi-day unit segmentation.
// Mirrors lessonParse.ts exactly — OPENAI_GEN_MODEL, json_object, throw LlmExhaustedError.
// No next/server, no Supabase.
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import {
  LESSON_GENERATE_SYSTEM, lessonGeneratePrompt,
  UNIT_SEGMENT_SYSTEM, unitSegmentPrompt,
} from '@/lib/openai/prompts';
import {
  GeneratedLessonSchema, type GeneratedLesson,
  UnitSegmentsSchema, type UnitSegments,
} from '@/lib/engine/types';
import { LlmExhaustedError } from '@/lib/ai/errors';
import { ZodError } from 'zod';

export const MAX_GENERATE_DAYS = 10;

export function resolveNumDays(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 2) return 1;
  return Math.min(n, MAX_GENERATE_DAYS);
}

export interface GenerateLessonInput {
  description: string;
  subject?: string | null;
  grade_level?: string | null;
  focus?: string | null;
  standardsGuidance?: string | null;
}

export async function generateLesson(input: GenerateLessonInput): Promise<GeneratedLesson> {
  if (!input.description.trim()) throw new Error('generateLesson: empty description');
  const completion = await resilientChatCompletion({
    model: OPENAI_GEN_MODEL,
    messages: [
      { role: 'system', content: LESSON_GENERATE_SYSTEM },
      { role: 'user', content: lessonGeneratePrompt(input) },
    ],
    temperature: 0.6,
    max_tokens: 2500,
    response_format: { type: 'json_object' },
  });
  if (!completion) throw new LlmExhaustedError('openai');
  const raw = completion.choices[0]?.message?.content || '{}';
  try {
    return GeneratedLessonSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof ZodError) throw new LlmExhaustedError('openai', err);
    throw err;
  }
}

export async function segmentUnit(input: {
  description: string;
  numDays: number;
  subject?: string | null;
  grade_level?: string | null;
}): Promise<UnitSegments> {
  const numDays = Math.min(Math.max(2, Math.floor(input.numDays)), MAX_GENERATE_DAYS);
  const completion = await resilientChatCompletion({
    model: OPENAI_GEN_MODEL,
    messages: [
      { role: 'system', content: UNIT_SEGMENT_SYSTEM },
      { role: 'user', content: unitSegmentPrompt({ ...input, numDays }) },
    ],
    temperature: 0.5,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  });
  if (!completion) throw new LlmExhaustedError('openai');
  const raw = completion.choices[0]?.message?.content || '{}';
  try {
    return UnitSegmentsSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof ZodError) throw new LlmExhaustedError('openai', err);
    throw err;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/engine/__tests__/lessonGenerate.test.ts`
Expected: PASS (8/8).

- [ ] **Step 7: Commit**

```bash
git add src/lib/engine/types.ts src/lib/openai/prompts.ts src/lib/engine/lessonGenerate.ts src/lib/engine/__tests__/lessonGenerate.test.ts
git commit -m "feat(content-studio): generateLesson + segmentUnit engine + prompts + schemas"
```

---

### Task 4: Engine — `extractTextFromUrl` (public/link-shared URL → plain text)

**Files:**
- Create: `src/lib/engine/parseUrl.ts`
- Test: `src/lib/engine/__tests__/parseUrl.test.ts`

**Interfaces:**
- Produces: `extractTextFromUrl(rawUrl: string): Promise<string>`; `stripHtml(html: string): string`; `class UrlFetchError extends Error`. Consumed by Task 7 (import-url route).
- Uses global `fetch` with a 10s `AbortController` timeout; strips HTML; truncates to 24k chars. Blocks loopback/private/metadata hosts (baseline SSRF guard — DNS-rebinding/full SSRF hardening is a documented deferral).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/engine/__tests__/parseUrl.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractTextFromUrl, stripHtml, UrlFetchError } from '@/lib/engine/parseUrl';

describe('stripHtml', () => {
  it('removes scripts/styles/tags and decodes basic entities', () => {
    const html = '<style>x{}</style><script>bad()</script><h1>Hello&amp;</h1><p>World &lt;3</p>';
    const out = stripHtml(html);
    expect(out).toContain('Hello&');
    expect(out).toContain('World <3');
    expect(out).not.toMatch(/bad\(\)|x\{\}|</);
  });
});

describe('extractTextFromUrl', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('rejects a non-URL', async () => {
    await expect(extractTextFromUrl('not a url')).rejects.toBeInstanceOf(UrlFetchError);
  });
  it('rejects non-http(s) protocols', async () => {
    await expect(extractTextFromUrl('ftp://example.com/x')).rejects.toBeInstanceOf(UrlFetchError);
  });
  it('rejects loopback/metadata hosts (SSRF baseline)', async () => {
    await expect(extractTextFromUrl('http://localhost/x')).rejects.toBeInstanceOf(UrlFetchError);
    await expect(extractTextFromUrl('http://127.0.0.1/x')).rejects.toBeInstanceOf(UrlFetchError);
    await expect(extractTextFromUrl('http://169.254.169.254/latest')).rejects.toBeInstanceOf(UrlFetchError);
    await expect(extractTextFromUrl('http://10.0.0.5/x')).rejects.toBeInstanceOf(UrlFetchError);
  });
  it('fetches + extracts text from a public URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html><body><h1>Photosynthesis</h1></body></html>', { status: 200 }),
    ) as unknown as typeof fetch;
    const text = await extractTextFromUrl('https://docs.google.com/document/d/abc/pub');
    expect(text).toContain('Photosynthesis');
  });
  it('throws UrlFetchError on a non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(extractTextFromUrl('https://example.com/missing')).rejects.toBeInstanceOf(UrlFetchError);
  });
  it('throws UrlFetchError when fetch itself rejects', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    await expect(extractTextFromUrl('https://example.com/x')).rejects.toBeInstanceOf(UrlFetchError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engine/__tests__/parseUrl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/engine/parseUrl.ts
// Import-safe. Fetch a public/link-shared URL (incl. published Google Docs) → plain text.
// The caller then runs the EXISTING parseLesson(). No next/server, no Supabase.
// Baseline SSRF guard: block loopback/private/metadata hosts. (DNS-rebinding / full SSRF
// hardening is deferred — documented in the plan.)

const FETCH_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS = 24_000;

export class UrlFetchError extends Error {}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '0.0.0.0' || h === '169.254.169.254' || h.startsWith('127.')) return true;
  if (h.startsWith('10.') || h.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function extractTextFromUrl(rawUrl: string): Promise<string> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new UrlFetchError("That doesn't look like a web address."); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlFetchError('Only http and https links are supported.');
  }
  if (isBlockedHost(url.hostname)) throw new UrlFetchError("We can't open that link.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: controller.signal, redirect: 'follow' });
  } catch {
    throw new UrlFetchError("We couldn't reach that link.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new UrlFetchError("We couldn't open that link.");
  const html = await res.text();
  return stripHtml(html).slice(0, MAX_TEXT_CHARS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/engine/__tests__/parseUrl.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/parseUrl.ts src/lib/engine/__tests__/parseUrl.test.ts
git commit -m "feat(content-studio): extractTextFromUrl (public URL → text, SSRF baseline guard)"
```

---

### Task 5: Route — `POST /api/teacher/lessons/generate`

**Files:**
- Create: `src/app/api/teacher/lessons/generate/route.ts`
- Test: `src/app/api/teacher/lessons/generate/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `generateLesson`, `segmentUnit`, `resolveNumDays` (`@/lib/engine/lessonGenerate`), `standardsGuidance`, `frameworkLabelForState`, `isUsStateCode` (`@/lib/standards/frameworks`), `guardClassAccess`, `respondEngineError`, `createServerSupabaseClient`/`createAdminSupabaseClient`.
- Request body: `{ description: string, class_id: string, subject?: string, grade_level?: string, num_days?: number, state?: string }`.
- Response 200: `{ chapter_title: string | null, framework: string, days: Array<{ lesson_id: string, day_index: number | null, title: string, subject: string | null, grade_level: string | null, parsed_content: GeneratedLesson, standard_framework: string }> }`. Consumed by Task 10 → Task 11.
- Persists N `lessons` rows (`status='pending_review'`, `source='generate'`, `parsed_content` = the generated lesson incl. `proposed_standards`, `standard_framework` = the framework label, `standard_codes` left `'{}'` until teacher confirms via `manage` `edit`). Single-day: `chapter_title=null`, `day_index=null`. Multi-day: `chapter_title=unit_title`, `day_index=1..N`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/teacher/lessons/generate/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
const generateLesson = vi.fn();
const segmentUnit = vi.fn();
const lessonInserts: Array<Record<string, unknown>[]> = [];
let ROLE: string; let SCHOOL_STATE: string | null;

vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/engine/lessonGenerate', () => ({
  generateLesson, segmentUnit,
  resolveNumDays: (raw: unknown) => { const n = Number(raw); return Number.isInteger(n) && n >= 2 ? Math.min(n, 10) : 1; },
  MAX_GENERATE_DAYS: 10,
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: ROLE, school_id: 's1' } }) }) }) };
      if (t === 'schools') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { state: SCHOOL_STATE } }) }) }) };
      // lessons — insert(rows).select(...) returns the rows with synthetic ids
      return {
        insert: (rows: Record<string, unknown>[]) => {
          lessonInserts.push(rows);
          return { select: async () => ({
            data: rows.map((r, i) => ({ id: `L${i + 1}`, ...r })), error: null,
          }) };
        },
      };
    },
  }),
}));

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
async function load() { vi.resetModules(); return (await import('@/app/api/teacher/lessons/generate/route')).POST; }

const oneLesson = {
  title: 'Fractions', summary: 's', objectives: ['o'], key_concepts: ['k'],
  vocabulary: [], misconception_risks: [], grade_level: '4', subject: 'Math',
  proposed_standards: [{ code: 'CCSS.4.NF.1', description: 'd' }],
};

beforeEach(() => {
  getUser.mockReset(); guardClassAccess.mockReset(); generateLesson.mockReset(); segmentUnit.mockReset();
  lessonInserts.length = 0; ROLE = 'teacher'; SCHOOL_STATE = 'TX';
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  guardClassAccess.mockResolvedValue(null);
  generateLesson.mockResolvedValue(oneLesson);
});

describe('POST /api/teacher/lessons/generate', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await (await load())(req({ description: 'x', class_id: 'c1' }))).status).toBe(401);
  });
  it('403 for a non-teacher role', async () => {
    ROLE = 'student';
    expect((await (await load())(req({ description: 'x', class_id: 'c1' }))).status).toBe(403);
  });
  it('403 when guardClassAccess denies', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await (await load())(req({ description: 'x', class_id: 'c1' }))).status).toBe(403);
  });
  it('400 on a missing description', async () => {
    expect((await (await load())(req({ class_id: 'c1' }))).status).toBe(400);
  });

  it('single day → 1 lesson, source=generate, chapter_title/day_index null, framework from state', async () => {
    const res = await (await load())(req({ description: 'Teach fractions', class_id: 'c1' }));
    expect(res.status).toBe(200);
    expect(segmentUnit).not.toHaveBeenCalled();
    const rows = lessonInserts[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'generate', status: 'pending_review', class_id: 'c1', teacher_id: 'u1', chapter_title: null, day_index: null });
    expect(rows[0].standard_framework).toMatch(/TEKS/); // state TX
    const body = await res.json();
    expect(body.days).toHaveLength(1);
    expect(body.days[0].lesson_id).toBe('L1');
    expect(body.framework).toMatch(/TEKS/);
  });

  it('multi-day → segmentUnit + N lessons with chapter_title + day_index', async () => {
    segmentUnit.mockResolvedValue({ unit_title: 'Ecosystems', days: [
      { day: 1, title: 'A', focus: 'fa' }, { day: 2, title: 'B', focus: 'fb' },
    ] });
    const res = await (await load())(req({ description: 'Ecosystems unit', class_id: 'c1', num_days: 2 }));
    expect(res.status).toBe(200);
    expect(segmentUnit).toHaveBeenCalledOnce();
    expect(generateLesson).toHaveBeenCalledTimes(2);
    const rows = lessonInserts[0];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.chapter_title === 'Ecosystems')).toBe(true);
    expect(rows.map((r) => r.day_index)).toEqual([1, 2]);
    const body = await res.json();
    expect(body.chapter_title).toBe('Ecosystems');
    expect(body.days.map((d: { day_index: number }) => d.day_index)).toEqual([1, 2]);
  });

  it('body.state overrides the school state for the framework', async () => {
    SCHOOL_STATE = 'TX';
    await (await load())(req({ description: 'x', class_id: 'c1', state: 'FL' }));
    expect(lessonInserts[0][0].standard_framework).toMatch(/B\.E\.S\.T/);
  });

  it('503 when generateLesson exhausts the LLM', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    generateLesson.mockRejectedValue(new LlmExhaustedError('openai'));
    expect((await (await load())(req({ description: 'x', class_id: 'c1' }))).status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/teacher/lessons/generate/__tests__/route.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Write the route** (auth chain mirrors `quizzes/generate/route.ts`)

```ts
// src/app/api/teacher/lessons/generate/route.ts
// POST — generate a lesson (single day or a multi-day unit) from a typed description.
// Auth: getUser → role ∈ TEACHER_ROLES → guardClassAccess (the ONLY IDOR backstop) → admin client.
// Standards-aware: resolves the school's US state (body.state override) → framework → prompt guidance.
// Persists N pending_review lessons (source='generate'); the teacher confirms standards + makes
// quizzes from the review surface. Engine throws LlmExhaustedError → respondEngineError → 503.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { generateLesson, segmentUnit, resolveNumDays } from '@/lib/engine/lessonGenerate';
import { standardsGuidance, frameworkLabelForState, isUsStateCode } from '@/lib/standards/frameworks';

const TEACHER_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminSupabaseClient();
    const { data: profile } = await admin.from('users').select('role, school_id').eq('id', user.id).single();
    const role: string | null = (profile as { role?: string } | null)?.role ?? null;
    if (!role || !TEACHER_ROLES.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const schoolId = (profile as { school_id?: string | null } | null)?.school_id ?? null;

    const body = (await req.json().catch(() => null)) as
      | { description?: string; class_id?: string; subject?: string; grade_level?: string; num_days?: number; state?: string }
      | null;
    const description = body?.description?.trim();
    const classId = body?.class_id;
    if (!description || !classId) return NextResponse.json({ error: 'Missing description or class_id' }, { status: 400 });

    const guard = await guardClassAccess(classId);
    if (guard) return guard;

    // Resolve the standards state: body override → school's stored state → null (degrades gracefully).
    let state: string | null = isUsStateCode(body?.state) ? (body!.state as string).toUpperCase() : null;
    if (!state && schoolId) {
      const { data: school } = await admin.from('schools').select('state').eq('id', schoolId).maybeSingle();
      const s = (school as { state?: string | null } | null)?.state ?? null;
      state = isUsStateCode(s) ? s!.toUpperCase() : null;
    }
    const framework = frameworkLabelForState(state);
    const guidance = standardsGuidance(state);

    const subject = body?.subject ?? null;
    const gradeLevel = body?.grade_level ?? null;
    const numDays = resolveNumDays(body?.num_days);

    // Generate the lesson(s).
    let chapterTitle: string | null = null;
    let generated: Array<{ dayIndex: number | null; lesson: Awaited<ReturnType<typeof generateLesson>> }>;
    if (numDays === 1) {
      const lesson = await generateLesson({ description, subject, grade_level: gradeLevel, standardsGuidance: guidance });
      generated = [{ dayIndex: null, lesson }];
    } else {
      const seg = await segmentUnit({ description, numDays, subject, grade_level: gradeLevel });
      chapterTitle = seg.unit_title;
      const lessons = await Promise.all(seg.days.map((d) =>
        generateLesson({ description, focus: d.focus, subject, grade_level: gradeLevel, standardsGuidance: guidance }),
      ));
      generated = seg.days.map((d, i) => ({ dayIndex: d.day, lesson: lessons[i] }));
    }

    // Persist all rows in one insert; return the inserted ids + content for the review surface.
    const rows = generated.map(({ dayIndex, lesson }) => ({
      class_id: classId,
      teacher_id: user.id,
      title: lesson.title || (chapterTitle ? `${chapterTitle} — Day ${dayIndex}` : 'Untitled lesson'),
      parsed_content: lesson,
      subject: lesson.subject ?? subject,
      grade_level: lesson.grade_level ?? gradeLevel,
      status: 'pending_review',
      source: 'generate',
      chapter_title: chapterTitle,
      day_index: dayIndex,
      standard_framework: framework,
    }));

    const { data: inserted, error: insErr } = await admin
      .from('lessons')
      .insert(rows)
      .select('id, day_index, title, subject, grade_level, parsed_content, standard_framework');
    if (insErr || !inserted) {
      return respondEngineError(new Error(`Failed to persist generated lessons: ${insErr?.message ?? 'no rows'}`));
    }

    const days = (inserted as Array<Record<string, unknown>>)
      .map((r) => ({
        lesson_id: r.id as string,
        day_index: (r.day_index as number | null) ?? null,
        title: r.title as string,
        subject: (r.subject as string | null) ?? null,
        grade_level: (r.grade_level as string | null) ?? null,
        parsed_content: r.parsed_content,
        standard_framework: (r.standard_framework as string) ?? framework,
      }))
      .sort((a, b) => (a.day_index ?? 0) - (b.day_index ?? 0));

    return NextResponse.json({ chapter_title: chapterTitle, framework, days });
  } catch (err) {
    console.error('[teacher/lessons/generate] error:', err);
    return respondEngineError(err);
  }
}
```

- [ ] **Step 4: Run test → PASS (8/8).** `npx vitest run src/app/api/teacher/lessons/generate/__tests__/route.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/teacher/lessons/generate/
git commit -m "feat(content-studio): POST /lessons/generate (single + multi-day, standards-aware)"
```

---

### Task 6: Extend `POST /api/teacher/lessons/manage` with an `edit` action

**Files:**
- Modify: `src/app/api/teacher/lessons/manage/route.ts`
- Modify: `src/app/api/teacher/lessons/manage/__tests__/route.test.ts`

**Interfaces:**
- Request body adds: `{ action: 'archive' | 'edit', title?, subject?, grade_level?, parsed_content?, standard_codes?: string[], standard_framework? }`. The `edit` action updates only the provided fields (scoped to the lesson; `guardClassAccess` unchanged). Consumed by Task 11 (save).
- Keep `archive` exactly as-is.

- [ ] **Step 1: Add failing tests** (append to the existing describe block; the existing mock already records `lessonUpdates`)

```ts
  it('edit updates only provided fields (title, parsed_content, standards)', async () => {
    const res = await (await load())(req({
      lesson_id: 'L1', action: 'edit',
      title: 'New title', standard_codes: ['CCSS.4.NF.1', 7 as unknown as string],
      standard_framework: 'TEKS', parsed_content: { summary: 's' },
    }));
    expect(res.status).toBe(200);
    const p = lessonUpdates[0];
    expect(p.title).toBe('New title');
    expect(p.standard_codes).toEqual(['CCSS.4.NF.1']); // non-strings filtered
    expect(p.standard_framework).toBe('TEKS');
    expect(p.parsed_content).toEqual({ summary: 's' });
    expect('status' in p).toBe(false); // edit never touches status
  });

  it('edit with nothing to update → 400', async () => {
    expect((await (await load())(req({ lesson_id: 'L1', action: 'edit' }))).status).toBe(400);
  });

  it('edit still enforces guardClassAccess', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await (await load())(req({ lesson_id: 'L1', action: 'edit', title: 'x' }))).status).toBe(403);
  });
```

- [ ] **Step 2: Run → the three new tests FAIL** (`action: 'edit'` rejected as unknown / 400 not matching).

Run: `npx vitest run src/app/api/teacher/lessons/manage/__tests__/route.test.ts`

- [ ] **Step 3: Implement the `edit` action** in `manage/route.ts`

Change the `Body` type + `ACTIONS`, and add the `edit` branch before the `archive` write:

```ts
type Body = {
  lesson_id?: string;
  action?: 'archive' | 'edit';
  title?: string;
  subject?: string | null;
  grade_level?: string | null;
  parsed_content?: unknown;
  standard_codes?: unknown;
  standard_framework?: string | null;
};
const ACTIONS = new Set(['archive', 'edit']);
```

Then, after the `guardClassAccess` check and before the existing `// archive — soft delete.` block:

```ts
    if (body.action === 'edit') {
      const patch: Record<string, unknown> = {};
      if (typeof body.title === 'string') patch.title = body.title;
      if ('subject' in body) patch.subject = body.subject ?? null;
      if ('grade_level' in body) patch.grade_level = body.grade_level ?? null;
      if (body.parsed_content && typeof body.parsed_content === 'object') patch.parsed_content = body.parsed_content;
      if (Array.isArray(body.standard_codes)) {
        patch.standard_codes = (body.standard_codes as unknown[]).filter((c): c is string => typeof c === 'string');
      }
      if ('standard_framework' in body) patch.standard_framework = body.standard_framework ?? null;
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

      const { error } = await admin.from('lessons').update(patch).eq('id', lesson.id);
      if (error) return NextResponse.json({ error: 'Server error' }, { status: 500 });
      return NextResponse.json({ ok: true, lesson_id: lesson.id, status: lesson.status });
    }
```

(The existing `archive` block stays exactly as-is, after this.)

- [ ] **Step 4: Run → all manage tests PASS** (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/teacher/lessons/manage/
git commit -m "feat(content-studio): lessons/manage edit action (title/content/standards)"
```

---

### Task 7: Route — `POST /api/teacher/lessons/import-url`

**Files:**
- Create: `src/app/api/teacher/lessons/import-url/route.ts`
- Test: `src/app/api/teacher/lessons/import-url/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `extractTextFromUrl`, `UrlFetchError` (`@/lib/engine/parseUrl`), `parseLesson` (`@/lib/engine/lessonParse`), the auth chain, `respondEngineError`.
- Request body: `{ url: string, class_id: string }`. Response 200: `{ lesson_id: string, parsed_content: ParsedLesson }` (same shape as `parse`). `UrlFetchError` → 400 `{ error, code: 'url_fetch' }`; `LlmExhaustedError` → `respondEngineError` (503). Inserts a `lessons` row `source='url'`, `status='pending_review'`. Consumed by Task 9 (URL tab) which then runs the existing fuzzy-dup gate + `/quizzes/generate`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/teacher/lessons/import-url/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
const extractTextFromUrl = vi.fn();
const parseLesson = vi.fn();
const lessonInserts: Array<Record<string, unknown>> = [];
let ROLE: string;

class UrlFetchError extends Error {}
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/engine/parseUrl', () => ({ extractTextFromUrl, UrlFetchError }));
vi.mock('@/lib/engine/lessonParse', () => ({ parseLesson }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: ROLE } }) }) }) };
      return { insert: (row: Record<string, unknown>) => { lessonInserts.push(row); return { select: () => ({ single: async () => ({ data: { id: 'L1', ...row }, error: null }) }) }; } };
    },
  }),
}));

const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) });
async function load() { vi.resetModules(); return (await import('@/app/api/teacher/lessons/import-url/route')).POST; }

beforeEach(() => {
  getUser.mockReset(); guardClassAccess.mockReset(); extractTextFromUrl.mockReset(); parseLesson.mockReset();
  lessonInserts.length = 0; ROLE = 'teacher';
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  guardClassAccess.mockResolvedValue(null);
  extractTextFromUrl.mockResolvedValue('A lesson about volcanoes.');
  parseLesson.mockResolvedValue({ title: 'Volcanoes', subject: 'Science', grade_level: '6', key_concepts: [] });
});

describe('POST /api/teacher/lessons/import-url', () => {
  it('401 / 403 / 400 gates', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await (await load())(req({ url: 'https://x', class_id: 'c1' }))).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    ROLE = 'student';
    expect((await (await load())(req({ url: 'https://x', class_id: 'c1' }))).status).toBe(403);
    ROLE = 'teacher';
    expect((await (await load())(req({ class_id: 'c1' }))).status).toBe(400);
  });
  it('403 when guardClassAccess denies', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await (await load())(req({ url: 'https://x', class_id: 'c1' }))).status).toBe(403);
  });
  it('happy path → inserts source=url + returns parsed_content', async () => {
    const res = await (await load())(req({ url: 'https://docs.google.com/d/x/pub', class_id: 'c1' }));
    expect(res.status).toBe(200);
    expect(lessonInserts[0]).toMatchObject({ source: 'url', status: 'pending_review', class_id: 'c1', teacher_id: 'u1' });
    const body = await res.json();
    expect(body.lesson_id).toBe('L1');
    expect(body.parsed_content.title).toBe('Volcanoes');
  });
  it('400 url_fetch on UrlFetchError', async () => {
    extractTextFromUrl.mockRejectedValue(new UrlFetchError("can't open"));
    const res = await (await load())(req({ url: 'https://bad', class_id: 'c1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('url_fetch');
  });
  it('503 when parseLesson exhausts the LLM', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    parseLesson.mockRejectedValue(new LlmExhaustedError('openai'));
    expect((await (await load())(req({ url: 'https://x', class_id: 'c1' }))).status).toBe(503);
  });
});
```

- [ ] **Step 2: Run → FAIL** (route not found). `npx vitest run src/app/api/teacher/lessons/import-url/__tests__/route.test.ts`

- [ ] **Step 3: Write the route**

```ts
// src/app/api/teacher/lessons/import-url/route.ts
// POST — import a lesson from a public / link-shared URL (incl. published Google Docs).
// Auth chain mirrors lessons/parse. Fetch+extract (SSRF-guarded) → existing parseLesson → insert
// source='url', pending_review. The client then runs the fuzzy-dup gate + /quizzes/generate.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { extractTextFromUrl, UrlFetchError } from '@/lib/engine/parseUrl';
import { parseLesson } from '@/lib/engine/lessonParse';

const TEACHER_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminSupabaseClient();
    const { data: profile } = await admin.from('users').select('role').eq('id', user.id).single();
    const role: string | null = (profile as { role?: string } | null)?.role ?? null;
    if (!role || !TEACHER_ROLES.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = (await req.json().catch(() => null)) as { url?: string; class_id?: string } | null;
    const url = body?.url?.trim();
    const classId = body?.class_id;
    if (!url || !classId) return NextResponse.json({ error: 'Missing url or class_id' }, { status: 400 });

    const guard = await guardClassAccess(classId);
    if (guard) return guard;

    let text: string;
    try {
      text = await extractTextFromUrl(url);
    } catch (err) {
      if (err instanceof UrlFetchError) {
        return NextResponse.json({ error: err.message, code: 'url_fetch' }, { status: 400 });
      }
      throw err;
    }
    if (!text.trim()) return NextResponse.json({ error: 'No readable text at that link.', code: 'url_fetch' }, { status: 400 });

    const parsed = await parseLesson(text); // throws LlmExhaustedError → caught below → 503

    let host = url;
    try { host = new URL(url).hostname; } catch { /* keep raw */ }

    const { data: lesson, error: insErr } = await admin.from('lessons').insert({
      class_id: classId,
      teacher_id: user.id,
      title: parsed.title || `Imported from ${host}`,
      file_url: url,
      parsed_content: parsed,
      subject: parsed.subject,
      grade_level: parsed.grade_level,
      status: 'pending_review',
      source: 'url',
    }).select('id').single();

    if (insErr || !lesson) {
      return respondEngineError(new Error(`Failed to persist imported lesson: ${insErr?.message ?? 'no row'}`));
    }
    return NextResponse.json({ lesson_id: (lesson as { id: string }).id, parsed_content: parsed });
  } catch (err) {
    console.error('[teacher/lessons/import-url] error:', err);
    return respondEngineError(err);
  }
}
```

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/api/teacher/lessons/import-url/__tests__/route.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/teacher/lessons/import-url/
git commit -m "feat(content-studio): POST /lessons/import-url (public URL → lesson)"
```

---

### Task 8: `LessonReviewEditor` — editable review of generated lesson(s) + standards confirm + make quizzes

**Files:**
- Create: `src/app/(teacher)/upload/_components/LessonReviewEditor.tsx`
- Test: `src/app/(teacher)/upload/_components/__tests__/LessonReviewEditor.test.tsx`

**Interfaces:**
- Consumes: `GeneratedLesson`, `ProposedStandard` (type-only, `@/lib/engine/types`); the `POST /lessons/manage` (`edit`) + `POST /quizzes/generate` routes (via `fetch`).
- Produces: `interface GeneratedDay { lesson_id: string; day_index: number | null; title: string; subject: string | null; grade_level: string | null; parsed_content: GeneratedLesson; standard_framework: string }`; `interface LessonReviewEditorProps { days: GeneratedDay[]; chapterTitle: string | null; framework: string; classId: string }`; default export `LessonReviewEditor`. Consumed by Task 9.
- Behavior: a multi-day pager (Day 1..N tabs) when `days.length > 1`. Per day the teacher edits title/subject/grade/summary and the arrays via newline textareas (objectives, key ideas, misconceptions; vocabulary as `term: definition` per line) and checks which AI-proposed standards to keep. **Save unit & make quizzes** loops each day: `POST /lessons/manage` `{action:'edit', title, subject, grade_level, parsed_content, standard_codes, standard_framework}` then `POST /quizzes/generate {lesson_id}`. Done state links to the Lesson + Quiz Libraries (`?class=` preserved). All strings DRAFT → Barb.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LessonReviewEditor, { type GeneratedDay } from '../LessonReviewEditor';

function day(over: Partial<GeneratedDay> = {}): GeneratedDay {
  return {
    lesson_id: 'L1', day_index: null, title: 'Fractions', subject: 'Math', grade_level: '4',
    standard_framework: 'TEKS',
    parsed_content: {
      title: 'Fractions', summary: 'Passage.', objectives: ['Add fractions'],
      key_concepts: ['numerator'], vocabulary: [{ term: 'fraction', definition: 'part of a whole' }],
      misconception_risks: ['bigger = more'], grade_level: '4', subject: 'Math',
      proposed_standards: [{ code: 'TEKS.4.3A', description: 'Represent fractions' }],
    },
    ...over,
  };
}

const calls: Array<{ url: string; body: unknown }> = [];
beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url: String(url), body });
    if (String(url).includes('/manage')) return new Response(JSON.stringify({ ok: true, lesson_id: body.lesson_id }), { status: 200 });
    return new Response(JSON.stringify({ quiz_id: 'Q1' }), { status: 200 });
  }) as unknown as typeof fetch;
});

describe('LessonReviewEditor', () => {
  it('renders the generated content into editable fields + shows proposed standards', () => {
    render(<LessonReviewEditor days={[day()]} chapterTitle={null} framework="TEKS" classId="c1" />);
    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe('Fractions');
    expect((screen.getByLabelText(/passage|summary/i) as HTMLTextAreaElement).value).toContain('Passage');
    expect(screen.getByText(/TEKS\.4\.3A/)).toBeInTheDocument();
  });

  it('save edits → calls manage edit then quizzes generate with confirmed standards', async () => {
    render(<LessonReviewEditor days={[day()]} chapterTitle={null} framework="TEKS" classId="c1" />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Fractions Day 1' } });
    fireEvent.click(screen.getByLabelText(/TEKS\.4\.3A/)); // confirm the proposed standard
    fireEvent.click(screen.getByRole('button', { name: /make quiz/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/quizzes/generate'))).toBe(true));
    const edit = calls.find((c) => c.url.includes('/manage'))!;
    expect((edit.body as { title: string }).title).toBe('Fractions Day 1');
    expect((edit.body as { standard_codes: string[] }).standard_codes).toEqual(['TEKS.4.3A']);
    expect((edit.body as { action: string }).action).toBe('edit');
    const gen = calls.find((c) => c.url.includes('/quizzes/generate'))!;
    expect((gen.body as { lesson_id: string }).lesson_id).toBe('L1');
  });

  it('multi-day → pager switches days and saves both', async () => {
    const days = [day({ lesson_id: 'L1', day_index: 1, title: 'Day 1' }), day({ lesson_id: 'L2', day_index: 2, title: 'Day 2' })];
    render(<LessonReviewEditor days={days} chapterTitle="Unit" framework="TEKS" classId="c1" />);
    expect(screen.getByRole('button', { name: /day 2/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /make quiz/i }));
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/quizzes/generate')).length).toBe(2));
    expect(calls.filter((c) => c.url.includes('/manage')).length).toBe(2);
  });

  it('shows a done state with library links after success', async () => {
    render(<LessonReviewEditor days={[day()]} chapterTitle={null} framework="TEKS" classId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: /make quiz/i }));
    await waitFor(() => expect(screen.getByRole('link', { name: /quiz library|open the quiz/i })).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run → FAIL** (component not found). `npx vitest run src/app/(teacher)/upload/_components/__tests__/LessonReviewEditor.test.tsx`

- [ ] **Step 3: Write the component**

```tsx
'use client';

/**
 * LessonReviewEditor — review/edit AI-generated lesson(s), confirm the AI-proposed standards,
 * then make a quiz per day. Forked from the read-only LessonViewPanel; here every field is editable.
 * Arrays edit as newline textareas (vocabulary as "term: definition" per line). Multi-day units get
 * a day pager. "Save unit & make quizzes" loops each day: /lessons/manage (edit) then /quizzes/generate.
 *
 * Teacher-only surface. Token-only Tailwind v4; deep-ink text; pop-art chrome. "Assignments", never
 * "Homework". All strings DRAFT → Barb (STRINGS-FOR-BARB.md §Content Studio).
 */
import React, { useState } from 'react';
import Link from 'next/link';
import type { GeneratedLesson, ProposedStandard } from '@/lib/engine/types';
import { SectionLabel } from '../../_components/SectionLabel';

export interface GeneratedDay {
  lesson_id: string;
  day_index: number | null;
  title: string;
  subject: string | null;
  grade_level: string | null;
  parsed_content: GeneratedLesson;
  standard_framework: string;
}
export interface LessonReviewEditorProps {
  days: GeneratedDay[];
  chapterTitle: string | null;
  framework: string;
  classId: string;
}

interface DayDraft {
  lesson_id: string;
  day_index: number | null;
  title: string;
  subject: string;
  grade_level: string;
  summary: string;
  objectives: string;
  concepts: string;
  vocab: string;
  misconceptions: string;
  proposed: ProposedStandard[];
  checked: Record<string, boolean>;
}

const linesToArray = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean);
const arrayToLines = (a: string[] | undefined): string => (a ?? []).join('\n');
const vocabToLines = (v: { term: string; definition: string }[] | undefined): string =>
  (v ?? []).map((x) => `${x.term}: ${x.definition}`).join('\n');
const linesToVocab = (s: string): { term: string; definition: string }[] =>
  linesToArray(s).map((line) => {
    const i = line.indexOf(':');
    return i === -1 ? { term: line, definition: '' } : { term: line.slice(0, i).trim(), definition: line.slice(i + 1).trim() };
  });

function toDraft(d: GeneratedDay): DayDraft {
  const p = d.parsed_content;
  return {
    lesson_id: d.lesson_id, day_index: d.day_index,
    title: d.title ?? p.title ?? '', subject: d.subject ?? p.subject ?? '', grade_level: d.grade_level ?? p.grade_level ?? '',
    summary: p.summary ?? '', objectives: arrayToLines(p.objectives), concepts: arrayToLines(p.key_concepts),
    vocab: vocabToLines(p.vocabulary), misconceptions: arrayToLines(p.misconception_risks),
    proposed: p.proposed_standards ?? [], checked: {},
  };
}

function draftToParsedContent(d: DayDraft): GeneratedLesson {
  return {
    title: d.title, summary: d.summary, objectives: linesToArray(d.objectives),
    key_concepts: linesToArray(d.concepts), vocabulary: linesToVocab(d.vocab),
    misconception_risks: linesToArray(d.misconceptions),
    grade_level: d.grade_level || undefined, subject: d.subject || undefined,
    proposed_standards: d.proposed,
  };
}

const INPUT = 'rounded-md border-2 border-sidebar-edge bg-bg px-3 py-2 text-fg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
const LABEL = 'font-display text-sm font-extrabold text-fg';

export function LessonReviewEditor({ days, chapterTitle, framework, classId }: LessonReviewEditorProps): React.JSX.Element {
  const [drafts, setDrafts] = useState<DayDraft[]>(() => days.map(toDraft));
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<'edit' | 'saving' | 'done' | 'error'>('edit');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastQuizId, setLastQuizId] = useState<string | null>(null);

  const multi = drafts.length > 1;
  const d = drafts[active];
  const lessonsHref = `/library/lessons?class=${encodeURIComponent(classId)}`;
  const quizzesHref = `/library/quizzes?class=${encodeURIComponent(classId)}`;

  function patch(p: Partial<DayDraft>) {
    setDrafts((prev) => prev.map((x, i) => (i === active ? { ...x, ...p } : x)));
  }
  function toggleStandard(code: string) {
    setDrafts((prev) => prev.map((x, i) => (i === active ? { ...x, checked: { ...x.checked, [code]: !x.checked[code] } } : x)));
  }

  async function saveAll() {
    setPhase('saving'); setError(null);
    try {
      let quizId: string | null = null;
      for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i];
        setProgress(multi ? `Saving day ${i + 1} of ${drafts.length}…` : 'Saving your lesson…');
        const codes = draft.proposed.map((s) => s.code).filter((c) => draft.checked[c]);
        const editRes = await fetch('/api/teacher/lessons/manage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lesson_id: draft.lesson_id, action: 'edit',
            title: draft.title, subject: draft.subject || null, grade_level: draft.grade_level || null,
            parsed_content: draftToParsedContent(draft), standard_codes: codes, standard_framework: framework,
          }),
        });
        if (!editRes.ok) throw new Error('save');
        setProgress(multi ? `Building quiz ${i + 1} of ${drafts.length}…` : 'Building a quiz…');
        const genRes = await fetch('/api/teacher/quizzes/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lesson_id: draft.lesson_id }),
        });
        if (!genRes.ok) throw new Error('quiz');
        const genBody = (await genRes.json().catch(() => ({}))) as { quiz_id?: string };
        quizId = genBody.quiz_id ?? quizId;
      }
      setLastQuizId(quizId);
      setPhase('done');
    } catch {
      setError("That didn't finish — give it another try in a moment.");
      setPhase('error');
    }
  }

  if (phase === 'done') {
    return (
      <div data-testid="generate-done" className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-ok-surface p-5 shadow-sticker">
        <SectionLabel tone="ok">{multi ? 'Unit ready' : 'Quiz ready'}</SectionLabel>
        <p className="font-display text-base font-bold text-fg">
          {multi ? `${drafts.length} lessons saved, each with a quiz drafted.` : 'Lesson saved and a quiz is drafted.'}
        </p>
        <p className="text-fg text-sm">Review and publish each quiz when it&apos;s ready for students.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={quizzesHref} className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker">
            {lastQuizId && !multi ? 'Open the quiz' : 'Open the Quiz Library'}
          </Link>
          <Link href={lessonsHref} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">
            Back to the Lesson Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {chapterTitle && (
        <div className="flex flex-col gap-1">
          <SectionLabel tone="brand">Unit</SectionLabel>
          <p className="font-display text-base font-bold text-fg">{chapterTitle}</p>
        </div>
      )}

      {multi && (
        <div role="tablist" aria-label="Days in this unit" className="flex flex-wrap gap-2">
          {drafts.map((dr, i) => (
            <button
              key={dr.lesson_id} type="button" role="tab" aria-selected={i === active}
              onClick={() => setActive(i)}
              className={[
                'rounded-md border-2 border-sidebar-edge px-3 py-1 font-display text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                i === active ? 'bg-brand text-fg-on-brand' : 'bg-surface text-fg',
              ].join(' ')}
            >
              Day {dr.day_index ?? i + 1}
            </button>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Title</span>
        <input className={INPUT} value={d.title} onChange={(e) => patch({ title: e.target.value })} />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>Subject</span>
          <input className={INPUT} value={d.subject} onChange={(e) => patch({ subject: e.target.value })} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>Grade</span>
          <input className={INPUT} value={d.grade_level} onChange={(e) => patch({ grade_level: e.target.value })} />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Lesson passage</span>
        <textarea className={`${INPUT} min-h-40`} value={d.summary} onChange={(e) => patch({ summary: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Learning goals <span className="font-normal text-fg-muted">(one per line)</span></span>
        <textarea className={`${INPUT} min-h-24`} value={d.objectives} onChange={(e) => patch({ objectives: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Key ideas <span className="font-normal text-fg-muted">(one per line)</span></span>
        <textarea className={`${INPUT} min-h-24`} value={d.concepts} onChange={(e) => patch({ concepts: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Vocabulary <span className="font-normal text-fg-muted">(term: definition, one per line)</span></span>
        <textarea className={`${INPUT} min-h-24`} value={d.vocab} onChange={(e) => patch({ vocab: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Watch for these mix-ups <span className="font-normal text-fg-muted">(one per line)</span></span>
        <textarea className={`${INPUT} min-h-24`} value={d.misconceptions} onChange={(e) => patch({ misconceptions: e.target.value })} />
      </label>

      <fieldset className="flex flex-col gap-2 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker">
        <legend className={LABEL}>Standards <span className="font-normal text-fg-muted">· {framework}</span></legend>
        {d.proposed.length === 0 && <p className="text-fg text-sm">No standards were proposed for this lesson. You can publish without them.</p>}
        {d.proposed.map((s) => (
          <label key={s.code} className="flex items-start gap-2 text-fg text-sm">
            <input type="checkbox" checked={!!d.checked[s.code]} onChange={() => toggleStandard(s.code)} aria-label={s.code} className="mt-1" />
            <span><span className="font-bold">{s.code}</span> — {s.description}</span>
          </label>
        ))}
      </fieldset>

      {phase === 'error' && error && (
        <p role="alert" className="rounded-lg border-2 border-sidebar-edge bg-warn-surface p-4 text-fg text-sm shadow-sticker">{error}</p>
      )}
      {phase === 'saving' && (
        <p role="status" aria-live="polite" className="rounded-lg border-2 border-sidebar-edge bg-surface p-4 text-fg text-sm shadow-sticker">{progress}</p>
      )}

      <div>
        <button
          type="button" onClick={saveAll} disabled={phase === 'saving'}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >
          {multi ? 'Save unit & make quizzes' : 'Save & make quiz'}
        </button>
      </div>
    </div>
  );
}

export default LessonReviewEditor;
```

- [ ] **Step 4: Run → PASS (4/4).** `npx vitest run src/app/(teacher)/upload/_components/__tests__/LessonReviewEditor.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/upload/_components/LessonReviewEditor.tsx" "src/app/(teacher)/upload/_components/__tests__/LessonReviewEditor.test.tsx"
git commit -m "feat(content-studio): LessonReviewEditor (edit generated lesson + confirm standards + make quizzes)"
```

---

### Task 9: `GenerateLessonStudio` — the "Generate with AI" tab

**Files:**
- Create: `src/app/(teacher)/upload/_components/GenerateLessonStudio.tsx`
- Test: `src/app/(teacher)/upload/_components/__tests__/GenerateLessonStudio.test.tsx`

**Interfaces:**
- Consumes: `US_STATES` (`@/lib/standards/frameworks`), `LessonReviewEditor` + `GeneratedDay` (Task 8), `POST /lessons/generate`.
- Produces: `interface GenerateLessonStudioProps { classId: string; schoolState: string | null }`; default export. Consumed by Task 11 (hub).
- Behavior: a form (description textarea required; subject; grade; days 1-10; US state select defaulting to `schoolState`). Submit → `POST /lessons/generate` → on success swap the form for `<LessonReviewEditor days={…} chapterTitle={…} framework={…} classId={…} />`. Error → the route's `userMessage`. State select carries a hint that it's optional and drives standards suggestions.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GenerateLessonStudio from '../GenerateLessonStudio';

let lastBody: Record<string, unknown> | null;
beforeEach(() => {
  lastBody = null;
  globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : null;
    return new Response(JSON.stringify({
      chapter_title: null, framework: 'TEKS',
      days: [{ lesson_id: 'L1', day_index: null, title: 'Fractions', subject: 'Math', grade_level: '4',
        standard_framework: 'TEKS', parsed_content: { title: 'Fractions', summary: 's', objectives: [], key_concepts: [], vocabulary: [], misconception_risks: [], proposed_standards: [] } }],
    }), { status: 200 });
  }) as unknown as typeof fetch;
});

describe('GenerateLessonStudio', () => {
  it('requires a description (button disabled until typed)', () => {
    render(<GenerateLessonStudio classId="c1" schoolState={null} />);
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
  });
  it('defaults the state select to the school state', () => {
    render(<GenerateLessonStudio classId="c1" schoolState="TX" />);
    expect((screen.getByLabelText(/state/i) as HTMLSelectElement).value).toBe('TX');
  });
  it('submits the description + class_id + state and then shows the review editor', async () => {
    render(<GenerateLessonStudio classId="c1" schoolState="TX" />);
    fireEvent.change(screen.getByLabelText(/describe|what.*teach|lesson/i), { target: { value: 'Teach adding fractions' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /make quiz/i })).toBeInTheDocument());
    expect(lastBody).toMatchObject({ description: 'Teach adding fractions', class_id: 'c1', state: 'TX' });
  });
  it('shows an error message when generate fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { userMessage: 'The system is busy — please try again in a moment.' } }), { status: 503 })) as unknown as typeof fetch;
    render(<GenerateLessonStudio classId="c1" schoolState={null} />);
    fireEvent.change(screen.getByLabelText(/describe|what.*teach|lesson/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/busy/i));
  });
});
```

- [ ] **Step 2: Run → FAIL** (component not found).

- [ ] **Step 3: Write the component**

```tsx
'use client';

/**
 * GenerateLessonStudio — the "Generate with AI" tab. The teacher describes a lesson (or unit), picks
 * an optional state for standards suggestions, and we generate a full lesson to review/edit. On
 * success we hand off to LessonReviewEditor. Token-only; deep-ink; strings DRAFT → Barb.
 */
import React, { useState } from 'react';
import { US_STATES } from '@/lib/standards/frameworks';
import LessonReviewEditor, { type GeneratedDay } from './LessonReviewEditor';
import { SectionLabel } from '../../_components/SectionLabel';

export interface GenerateLessonStudioProps {
  classId: string;
  schoolState: string | null;
}

interface GenerateResult {
  chapter_title: string | null;
  framework: string;
  days: GeneratedDay[];
}

const INPUT = 'rounded-md border-2 border-sidebar-edge bg-bg px-3 py-2 text-fg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
const LABEL = 'font-display text-sm font-extrabold text-fg';

export function GenerateLessonStudio({ classId, schoolState }: GenerateLessonStudioProps): React.JSX.Element {
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [numDays, setNumDays] = useState(1);
  const [state, setState] = useState(schoolState ?? '');
  const [phase, setPhase] = useState<'form' | 'generating' | 'error'>('form');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);

  if (result) {
    return <LessonReviewEditor days={result.days} chapterTitle={result.chapter_title} framework={result.framework} classId={classId} />;
  }

  async function onGenerate() {
    if (!description.trim() || phase === 'generating') return;
    setPhase('generating'); setError(null);
    try {
      const res = await fetch('/api/teacher/lessons/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(), class_id: classId,
          subject: subject || undefined, grade_level: grade || undefined,
          num_days: numDays, state: state || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { userMessage?: string } } | null;
        setError(body?.error?.userMessage ?? "That didn't work — give it another try in a moment.");
        setPhase('error');
        return;
      }
      setResult((await res.json()) as GenerateResult);
    } catch {
      setError("That didn't work — give it another try in a moment.");
      setPhase('error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={LABEL}>What should this lesson teach?</span>
        <textarea
          className={`${INPUT} min-h-32`} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. A 7th-grade intro to photosynthesis: inputs, outputs, and why it matters."
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>Subject <span className="font-normal text-fg-muted">(optional)</span></span>
          <input className={INPUT} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>Grade <span className="font-normal text-fg-muted">(optional)</span></span>
          <input className={INPUT} value={grade} onChange={(e) => setGrade(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Days</span>
          <input
            type="number" min={1} max={10} className={`${INPUT} w-24`} value={numDays}
            onChange={(e) => setNumDays(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={LABEL}>State <span className="font-normal text-fg-muted">(optional — suggests standards)</span></span>
          <select className={INPUT} value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
            <option value="">No state</option>
            {US_STATES.map((s) => (<option key={s.code} value={s.code}>{s.name}</option>))}
          </select>
        </label>
      </div>

      {phase === 'error' && error && (
        <p role="alert" className="rounded-lg border-2 border-sidebar-edge bg-warn-surface p-4 text-fg text-sm shadow-sticker">{error}</p>
      )}
      {phase === 'generating' && (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker">
          <SectionLabel tone="brand">Working</SectionLabel>
          <span className="text-fg text-sm">{numDays > 1 ? 'Writing your unit…' : 'Writing your lesson…'}</span>
        </div>
      )}

      <div>
        <button
          type="button" onClick={onGenerate} disabled={!description.trim() || phase === 'generating'}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >
          Generate
        </button>
      </div>
    </div>
  );
}

export default GenerateLessonStudio;
```

- [ ] **Step 4: Run → PASS (4/4).**

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/upload/_components/GenerateLessonStudio.tsx" "src/app/(teacher)/upload/_components/__tests__/GenerateLessonStudio.test.tsx"
git commit -m "feat(content-studio): GenerateLessonStudio (describe → generate → review)"
```

---

### Task 10: Extract shared `DupModal` + build `UrlImportStudio` (the "From a URL" tab)

**Files:**
- Create: `src/app/(teacher)/upload/_components/DupModal.tsx` (exact move of the inline `DupModal` from `UploadStudio.tsx`)
- Modify: `src/app/(teacher)/upload/_components/UploadStudio.tsx` (import `DupModal`, delete the inline copy + its `FOCUSABLE`/`DupModalProps`)
- Create: `src/app/(teacher)/upload/_components/UrlImportStudio.tsx`
- Test: `src/app/(teacher)/upload/_components/__tests__/UrlImportStudio.test.tsx`

**Interfaces:**
- Produces: `DupModal({ testId, title, onClose, children })` (named + default export); `interface UrlImportStudioProps { classId: string; existingLessons: UploadLessonLite[] }` (reuses `UploadLessonLite` from `UploadStudio`); default export. Consumed by Task 11.
- `UrlImportStudio` mirrors the Upload chain minus the file: `POST /import-url {url, class_id}` → client `detectDuplicates` fuzzy gate (`DupModal`) → `POST /quizzes/generate`. `400 url_fetch` → inline error from `body.error`. Declining the fuzzy dup archives the orphan via `POST /lessons/manage {action:'archive'}` (same best-effort pattern as `UploadStudio`).

- [ ] **Step 1: Create `DupModal.tsx`** — cut the `FOCUSABLE` const + `DupModalProps` interface + `DupModal` function verbatim from `UploadStudio.tsx` into a new file with a `'use client'` header and these exports:

```tsx
'use client';

/** Shared Content Studio modal: role="dialog", focus trap, Escape-to-close, click-scrim-to-close,
 *  focus restoration to the trigger. Extracted from UploadStudio so UrlImportStudio reuses it. */
import React, { useEffect, useRef } from 'react';

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

export interface DupModalProps {
  testId: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function DupModal({ testId, title, onClose, children }: DupModalProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    closeRef.current?.focus();
    return () => { triggerRef.current?.focus?.(); };
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key === 'Tab') {
      const root = panelRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.hasAttribute('disabled'));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
  }

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-fg/30" />
      <div
        ref={panelRef} data-testid={testId} role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}
        className="fixed left-1/2 top-1/2 z-30 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border-2 border-sidebar-edge bg-surface p-5 shadow-sticker-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-base font-extrabold text-fg">{title}</h2>
          <button
            type="button" ref={closeRef} onClick={onClose} aria-label="Close"
            className="rounded-md border-2 border-sidebar-edge px-2 py-1 text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >✕</button>
        </div>
        {children}
      </div>
    </>
  );
}

export default DupModal;
```

- [ ] **Step 2: Refactor `UploadStudio.tsx`** — delete the inline `FOCUSABLE` const, `DupModalProps`, and `DupModal` function (lines 408–473 in the current file); add `import { DupModal } from './DupModal';` near the other imports. No behavior change.

- [ ] **Step 3: Run the EXISTING UploadStudio test to confirm no regression**

Run: `npx vitest run "src/app/(teacher)/upload/_components/__tests__/UploadStudio.test.tsx"`
Expected: PASS (unchanged) — the modal moved but behaves identically.

- [ ] **Step 4: Write the failing UrlImportStudio test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UrlImportStudio from '../UrlImportStudio';

const calls: Array<{ url: string; body: unknown }> = [];
function mockFetch(handlers: Record<string, () => Response>) {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body as string) : null });
    const key = Object.keys(handlers).find((k) => u.includes(k));
    return key ? handlers[key]() : new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => { calls.length = 0; });

describe('UrlImportStudio', () => {
  it('imports a URL with no dup → goes straight to a drafted quiz', async () => {
    mockFetch({
      '/import-url': () => new Response(JSON.stringify({ lesson_id: 'L1', parsed_content: { title: 'New Topic', key_concepts: ['x'] } }), { status: 200 }),
      '/quizzes/generate': () => new Response(JSON.stringify({ quiz_id: 'Q1' }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), { target: { value: 'https://docs.google.com/d/x/pub' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());
    expect(calls[0].url).toContain('/import-url');
    expect(calls.some((c) => c.url.includes('/quizzes/generate'))).toBe(true);
  });

  it('shows the url_fetch error message inline', async () => {
    mockFetch({ '/import-url': () => new Response(JSON.stringify({ error: "We couldn't open that link.", code: 'url_fetch' }), { status: 400 }) });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), { target: { value: 'https://bad' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t open/i));
  });

  it('gates quiz-gen behind the fuzzy-dup modal when a near match exists', async () => {
    mockFetch({
      '/import-url': () => new Response(JSON.stringify({ lesson_id: 'L1', parsed_content: { title: 'Photosynthesis', key_concepts: ['light', 'chlorophyll'] } }), { status: 200 }),
      '/quizzes/generate': () => new Response(JSON.stringify({ quiz_id: 'Q1' }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[{ id: 'E1', title: 'Photosynthesis', concept_tags: ['light', 'chlorophyll'], status: 'draft' }]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), { target: { value: 'https://x' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByTestId('fuzzy-dup-modal')).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes('/quizzes/generate'))).toBe(false); // gated
  });
});
```

- [ ] **Step 5: Run → FAIL** (component not found).

- [ ] **Step 6: Write `UrlImportStudio.tsx`**

```tsx
'use client';

/**
 * UrlImportStudio — the "From a URL" tab. Imports a public / link-shared URL (incl. published
 * Google Docs) into a lesson, runs the same fuzzy-duplicate gate as the file uploader, then drafts
 * a quiz. Reuses the shared DupModal + detectDuplicates. Token-only; deep-ink; strings DRAFT → Barb.
 */
import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { detectDuplicates, type LessonRowLite } from '@/lib/lessons/duplicateDetect';
import { DupModal } from './DupModal';
import type { UploadLessonLite } from './UploadStudio';
import { SectionLabel } from '../../_components/SectionLabel';

export interface UrlImportStudioProps {
  classId: string;
  existingLessons: UploadLessonLite[];
}

type Phase = 'idle' | 'importing' | 'checking' | 'building' | 'done' | 'error';

const INPUT = 'rounded-md border-2 border-sidebar-edge bg-bg px-3 py-2 text-fg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function UrlImportStudio({ classId, existingLessons }: UrlImportStudioProps): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [fuzzyMatch, setFuzzyMatch] = useState<LessonRowLite | null>(null);
  const lessonIdRef = useRef<string | null>(null);

  const lessonsHref = `/library/lessons?class=${encodeURIComponent(classId)}`;
  const quizzesHref = `/library/quizzes?class=${encodeURIComponent(classId)}`;
  const busy = phase === 'importing' || phase === 'checking' || phase === 'building';

  function fail(message: string) { setError(message); setPhase('error'); }

  function archivePendingLesson() {
    const lessonId = lessonIdRef.current;
    if (!lessonId) return;
    void fetch('/api/teacher/lessons/manage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson_id: lessonId, action: 'archive' }),
    }).catch(() => {});
  }

  async function onImport() {
    if (!url.trim() || busy) return;
    setError(null); setFuzzyMatch(null); setQuizId(null);
    setPhase('importing');
    let res: Response;
    try {
      res = await fetch('/api/teacher/lessons/import-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), class_id: classId }),
      });
    } catch { fail("We couldn't reach that link."); return; }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      fail(body?.error ?? "That didn't import — check the link and try again.");
      return;
    }
    const body = (await res.json()) as { lesson_id: string; parsed_content?: { title?: string | null; key_concepts?: string[] } };
    lessonIdRef.current = body.lesson_id;
    const parsed = body.parsed_content ?? {};

    setPhase('checking');
    const candidate = { title: parsed.title ?? null, concept_tags: Array.isArray(parsed.key_concepts) ? parsed.key_concepts : [] };
    const matches = detectDuplicates(candidate, existingLessons as LessonRowLite[]);
    if (matches.length > 0) { setFuzzyMatch(matches[0].lesson); setPhase('idle'); return; }
    await doGenerate(body.lesson_id);
  }

  async function doGenerate(lessonId: string) {
    setPhase('building');
    const res = await fetch('/api/teacher/quizzes/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson_id: lessonId }),
    });
    if (!res.ok) { fail("The quiz didn't draft — try the link again."); return; }
    const body = (await res.json()) as { quiz_id?: string };
    setQuizId(body.quiz_id ?? null);
    setPhase('done');
  }

  function onCreateAnyway() {
    const lessonId = lessonIdRef.current;
    setFuzzyMatch(null);
    if (lessonId) void doGenerate(lessonId).catch(() => fail("The quiz didn't draft — try the link again."));
  }
  function onCancelFuzzy() { archivePendingLesson(); setFuzzyMatch(null); setPhase('idle'); }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-display text-sm font-extrabold text-fg">Paste a link</span>
        <span className="text-fg text-sm">A public web page or a shared Google Doc (&ldquo;Anyone with the link&rdquo;). We&apos;ll read it and draft a quiz.</span>
        <input
          className={INPUT} type="url" inputMode="url" value={url} aria-label="Link or web address"
          onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
        />
      </label>

      <div>
        <button
          type="button" onClick={onImport} disabled={!url.trim() || busy}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >Import</button>
      </div>

      {busy && (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker">
          <SectionLabel tone="brand">Working</SectionLabel>
          <span className="text-fg text-sm">{phase === 'importing' ? 'Reading that link…' : phase === 'checking' ? 'Checking your library…' : 'Building a quiz…'}</span>
        </div>
      )}

      {phase === 'error' && error && (
        <p role="alert" className="rounded-lg border-2 border-sidebar-edge bg-warn-surface p-4 text-fg text-sm shadow-sticker">{error}</p>
      )}

      {phase === 'done' && (
        <div data-testid="upload-done" className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-ok-surface p-5 shadow-sticker">
          <SectionLabel tone="ok">Quiz ready</SectionLabel>
          <p className="font-display text-base font-bold text-fg">Lesson imported and a quiz is drafted.</p>
          <p className="text-fg text-sm">Review and publish the quiz when it&apos;s ready for students.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={quizzesHref} className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker">
              {quizId ? 'Open the quiz' : 'Open the Quiz Library'}
            </Link>
            <Link href={lessonsHref} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">
              Back to the Lesson Library
            </Link>
          </div>
        </div>
      )}

      {fuzzyMatch && (
        <DupModal testId="fuzzy-dup-modal" title="This looks a lot like a lesson you already have." onClose={onCancelFuzzy}>
          <p className="text-fg text-sm">It&apos;s close to <span className="font-bold">{fuzzyMatch.title ?? 'an existing lesson'}</span>.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={lessonsHref} onClick={archivePendingLesson} className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker">Use that one</Link>
            <button type="button" onClick={onCreateAnyway} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">Create anyway</button>
            <button type="button" onClick={onCancelFuzzy} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">Cancel</button>
          </div>
        </DupModal>
      )}
    </div>
  );
}

export default UrlImportStudio;
```

- [ ] **Step 7: Run → PASS** (UrlImportStudio 3/3 + UploadStudio unchanged). `npx vitest run "src/app/(teacher)/upload/_components/__tests__/UrlImportStudio.test.tsx" "src/app/(teacher)/upload/_components/__tests__/UploadStudio.test.tsx"`

- [ ] **Step 8: Commit**

```bash
git add "src/app/(teacher)/upload/_components/DupModal.tsx" "src/app/(teacher)/upload/_components/UploadStudio.tsx" "src/app/(teacher)/upload/_components/UrlImportStudio.tsx" "src/app/(teacher)/upload/_components/__tests__/UrlImportStudio.test.tsx"
git commit -m "feat(content-studio): extract DupModal + UrlImportStudio (From a URL tab)"
```

---

### Task 11: `ContentStudioTabs` — the three-tab hub

**Files:**
- Create: `src/app/(teacher)/upload/_components/ContentStudioTabs.tsx`
- Test: `src/app/(teacher)/upload/_components/__tests__/ContentStudioTabs.test.tsx`

**Interfaces:**
- Consumes: `UploadStudio` + `UploadLessonLite`, `UrlImportStudio`, `GenerateLessonStudio`.
- Produces: `interface ContentStudioTabsProps { classId: string; existingLessons: UploadLessonLite[]; schoolState: string | null }`; default export. Consumed by Task 12 (page).
- ARIA tablist: three tabs ("Upload a file" · "From a URL" · "Generate with AI"), `role="tab"` + `aria-selected` + `aria-controls`, arrow-key (Left/Right) roving selection, one visible `role="tabpanel"` at a time. Default tab = Upload a file.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ContentStudioTabs from '../ContentStudioTabs';

beforeEach(() => { globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch; });

describe('ContentStudioTabs', () => {
  it('renders three tabs, Upload selected by default', () => {
    render(<ContentStudioTabs classId="c1" existingLessons={[]} schoolState={null} />);
    expect(screen.getByRole('tab', { name: /upload a file/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /from a url/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /generate with ai/i })).toBeInTheDocument();
    expect(screen.getByText(/drop a lesson here/i)).toBeInTheDocument(); // UploadStudio panel
  });

  it('switches to the URL tab on click', () => {
    render(<ContentStudioTabs classId="c1" existingLessons={[]} schoolState={null} />);
    fireEvent.click(screen.getByRole('tab', { name: /from a url/i }));
    expect(screen.getByLabelText(/link or web address/i)).toBeInTheDocument();
  });

  it('switches to the Generate tab and passes the school state', () => {
    render(<ContentStudioTabs classId="c1" existingLessons={[]} schoolState="TX" />);
    fireEvent.click(screen.getByRole('tab', { name: /generate with ai/i }));
    expect(screen.getByLabelText(/what should this lesson teach/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/state/i) as HTMLSelectElement).value).toBe('TX');
  });

  it('ArrowRight moves selection to the next tab', () => {
    render(<ContentStudioTabs classId="c1" existingLessons={[]} schoolState={null} />);
    const first = screen.getByRole('tab', { name: /upload a file/i });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /from a url/i })).toHaveAttribute('aria-selected', 'true');
  });
});
```

- [ ] **Step 2: Run → FAIL** (component not found).

- [ ] **Step 3: Write the component**

```tsx
'use client';

/**
 * ContentStudioTabs — the three input modes of the Content Studio: Upload a file, From a URL,
 * Generate with AI. ARIA tablist with roving arrow-key selection. Token-only; deep-ink. One
 * sidebar entry; this is the whole "create a lesson" surface. Strings DRAFT → Barb.
 */
import React, { useRef, useState } from 'react';
import { UploadStudio, type UploadLessonLite } from './UploadStudio';
import UrlImportStudio from './UrlImportStudio';
import GenerateLessonStudio from './GenerateLessonStudio';

export interface ContentStudioTabsProps {
  classId: string;
  existingLessons: UploadLessonLite[];
  schoolState: string | null;
}

const TABS = [
  { id: 'upload', label: 'Upload a file' },
  { id: 'url', label: 'From a URL' },
  { id: 'generate', label: 'Generate with AI' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function ContentStudioTabs({ classId, existingLessons, schoolState }: ContentStudioTabsProps): React.JSX.Element {
  const [active, setActive] = useState<TabId>('upload');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = e.key === 'ArrowRight' ? (index + 1) % TABS.length : (index - 1 + TABS.length) % TABS.length;
    setActive(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Create a lesson" className="flex flex-wrap gap-2">
        {TABS.map((t, i) => (
          <button
            key={t.id} type="button" role="tab" id={`cs-tab-${t.id}`} aria-controls={`cs-panel-${t.id}`}
            aria-selected={active === t.id} tabIndex={active === t.id ? 0 : -1}
            ref={(el) => { tabRefs.current[i] = el; }}
            onClick={() => setActive(t.id)} onKeyDown={(e) => onKeyDown(e, i)}
            className={[
              'rounded-md border-2 border-sidebar-edge px-4 py-2 font-display text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              active === t.id ? 'bg-brand text-fg-on-brand' : 'bg-surface text-fg',
            ].join(' ')}
          >{t.label}</button>
        ))}
      </div>

      <div role="tabpanel" id={`cs-panel-${active}`} aria-labelledby={`cs-tab-${active}`}>
        {active === 'upload' && <UploadStudio classId={classId} existingLessons={existingLessons} />}
        {active === 'url' && <UrlImportStudio classId={classId} existingLessons={existingLessons} />}
        {active === 'generate' && <GenerateLessonStudio classId={classId} schoolState={schoolState} />}
      </div>
    </div>
  );
}

export default ContentStudioTabs;
```

- [ ] **Step 4: Run → PASS (4/4).**

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/upload/_components/ContentStudioTabs.tsx" "src/app/(teacher)/upload/_components/__tests__/ContentStudioTabs.test.tsx"
git commit -m "feat(content-studio): ContentStudioTabs hub (upload · url · generate)"
```

---

### Task 12: Wire the Upload page to the tabbed hub + fetch the school state

**Files:**
- Modify: `src/app/(teacher)/upload/page.tsx`

**Interfaces:**
- Consumes: `ContentStudioTabs` (Task 11). Resolves the school's `state` via the class → school (admin client) so the Generate tab can default the standards state.
- This is a server-component wiring task (no unit test in this repo for server pages — verified by `tsc` + `build` + Playwright preview, per the propose-only UI discipline).

- [ ] **Step 1: Edit the page** — replace the `UploadStudio` import + render with `ContentStudioTabs`, and fetch the school state after the existing `existingLessons` block:

```tsx
// imports: swap UploadStudio for the hub
import { ContentStudioTabs } from './_components/ContentStudioTabs';
import type { UploadLessonLite } from './_components/UploadStudio';
```

After the `existingLessons` mapping, before the `return`:

```tsx
  // School state (for the Generate tab's standards suggestions). Resolved class → school; null when
  // unset (most schools today) — the standards step then degrades to optional.
  let schoolState: string | null = null;
  const { data: classRow } = await admin.from('classes').select('school_id').eq('id', classId).maybeSingle();
  const schoolId = (classRow as { school_id?: string | null } | null)?.school_id ?? null;
  if (schoolId) {
    const { data: school } = await admin.from('schools').select('state').eq('id', schoolId).maybeSingle();
    schoolState = (school as { state?: string | null } | null)?.state ?? null;
  }
```

Replace the render block:

```tsx
  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Content Studio" kicker="Create a lesson" accent="brand" />
      <ContentStudioTabs classId={classId} existingLessons={existingLessons} schoolState={schoolState} />
    </div>
  );
```

(Keep the `UploadLessonLite` type import — it still types `existingLessons`.)

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit` → 0 errors. Then `npm run build` → 0 errors.

- [ ] **Step 3: Playwright preview (propose-only gate)** — start the dev server, open `/upload?class=<demo class>`, screenshot all three tabs (Upload / From a URL / Generate with AI) + a generated single lesson review + a 2-day unit. **Surface the screenshots to Marvin; apply no proposed visual change without approval.**

- [ ] **Step 4: Commit**

```bash
git add "src/app/(teacher)/upload/page.tsx"
git commit -m "feat(content-studio): Upload page → Content Studio tabbed hub + school-state resolve"
```

---

### Task 13: Barb strings + full gate pass

**Files:**
- Modify: `STRINGS-FOR-BARB.md` (§Content Studio)

- [ ] **Step 1: Add the new DRAFT strings** to `STRINGS-FOR-BARB.md §Content Studio` (grouped under a "Seg 2 — Generate / URL import" subheading): the tab labels ("Upload a file" / "From a URL" / "Generate with AI"); the page header ("Content Studio" / kicker "Create a lesson"); the Generate form labels + placeholders ("What should this lesson teach?", subject/grade/Days/State, "No state", "optional — suggests standards", "Generate", "Writing your lesson…/unit…"); the review editor labels ("Lesson passage", "Learning goals", "Key ideas", "Vocabulary (term: definition…)", "Watch for these mix-ups", "Standards · <framework>", "No standards were proposed…", "Save & make quiz" / "Save unit & make quizzes", progress + done copy); the URL tab copy ("Paste a link", the Google-Doc hint, "Import", "Reading that link…", url-fetch errors); and the multi-day "Unit" / "Day N" labels. Mark all as DRAFT → Barb gates.

- [ ] **Step 2: Run the full gate suite**

```bash
npx tsc --noEmit            # 0 errors
npm test                    # all green (existing + new)
npm run build               # 0 errors (includes a11y + tokens:check via prebuild)
npm run a11y                # WCAG-AA pass
npm run tokens:check        # tokens in sync
```

Expected: all pass. Fix any failure before proceeding.

- [ ] **Step 3: Commit**

```bash
git add STRINGS-FOR-BARB.md
git commit -m "docs(content-studio): Seg 2 string drafts for Barb"
```

---

## Deferrals & decisions (carry into the final review + the merge call)

Decisions I made while planning (flag to Marvin at the merge call; none block the build):
- **`schools.state` is added but unpopulated.** Provisioning does not capture an address/state today, so the column is null for every existing school. The Generate tab therefore asks the teacher to confirm the state inline (defaulting to `schools.state` when present). **Auto-populating `schools.state` at provisioning is a follow-up for the provisioning/Google epic.**
- **Confirmed standards persist in dedicated columns** (`lessons.standard_codes text[]`, `lessons.standard_framework text`) rather than inside `parsed_content` — consistent with how `subject`/`grade_level` are top-level, and future-proof for filtering in the library/insights. The AI-proposed (unconfirmed) standards stay inside `parsed_content.proposed_standards` for the record.
- **URL import follows the upload pattern, not the generate/review pattern** — externally authored content (a file or a link) flows parse → fuzzy-dup gate → quiz; only AI-authored lessons get the editable review surface. The teacher can still edit an imported lesson later from the library.
- **Quizzes generate synchronously** (reusing the existing `/quizzes/generate`), matching V2's current model — not V1's fire-and-forget `triggerQuizGeneration`/`quiz_generation_status`. Multi-day loops day-by-day with visible progress.

Deferred (documented, not built — surface in `log`/the merge note, never silently):
- **Full SSRF hardening** of `extractTextFromUrl` (DNS-rebinding, resolved-IP checks, redirect re-validation). Built: a baseline loopback/private/metadata host block. Real risk is low (teacher-authenticated trust path) but note it.
- **Private Google Docs** (require Google sign-in / Drive OAuth) → the Google integration epic; Seg 2 ships public/link-shared URLs only.
- **Curated per-state standards library** (a real standards reference table + code verification) → its own data-heavy epic. Seg 2 trusts the model's proposed codes + teacher confirmation; no verification lookup.
- **Applying migration 0020 to the live NEW CORE DB** is Marvin's explicit call (no DDL to prod from this build). After apply, reseed/verify per the established epic cadence.

## Self-Review (run against the locked decisions + spec)

**Spec coverage** — every locked decision (`v2-content-studio-seg2-decisions.md`) maps to a task:
- D1 three-tab hub → Task 11 (+12). · D2 full lesson reusing `ParsedLessonSchema` (summary = passage) → Task 3 + 8. · D3 standards-aware propose-and-confirm, state-derived, graceful when null, independents opt out → Task 2 (frameworks) + 5 (route resolve) + 8 (confirm checkboxes) + 12 (state from school). · D4 multi-day via `chapter_title`/`day_index`, segment→N gens, cap 10 → Task 1 + 3 + 5. · D5 URL import (public now) → Task 4 + 7 + 10. · Engine purity / `LlmExhaustedError` / `respondEngineError` / auth chain → Tasks 3–7. · `source='generate'`/`'url'` (no CHECK change) → confirmed in grounding.

**Placeholder scan:** none — every code step carries complete, runnable code; every test names exact commands + expected results.

**Type consistency:** `GeneratedDay`/`GeneratedLesson`/`ProposedStandard` are defined once (Tasks 8/3) and reused by signature in Tasks 9/11; the route response shape in Task 5 (`{chapter_title, framework, days[]}`) matches `GenerateResult` consumed in Task 9; `manage` `edit` body in Task 6 matches the `fetch` body in Task 8; `UploadLessonLite` is imported from `UploadStudio` everywhere (not re-declared).

**Pre-flight conflict check:** none of the tasks contradict each other or the Global Constraints. The only plan-vs-rubric note: Task 12 is a server-component wiring task without a unit test (repo has no server-page tests) — verified by `tsc`/`build`/Playwright; this is a deliberate, stated exception, not an oversight.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-23-content-studio-seg2.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh implementer subagent per task, task review (spec + quality) between tasks, broad whole-branch adversarial review at the end (the in-house multi-lens Workflow is the primary review), then Playwright preview for Marvin and the merge call.

**2. Inline Execution** — execute tasks in this session with checkpoints.

**Which approach?**
