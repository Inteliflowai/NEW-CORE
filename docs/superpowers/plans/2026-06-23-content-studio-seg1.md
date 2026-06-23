# Content Studio — Segment 1 Implementation Plan (Upload + Libraries + Publish + Dedup)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** turn the three dead authoring stubs (Upload, Lesson Library, Quiz Library) into a working loop — a teacher uploads a PDF/DOCX/TXT, it auto-becomes a parsed lesson + a generated quiz, they manage both in flat searchable libraries, edit a quiz, and **publish** it to students — with a **duplicate-lesson warning** (exact + fuzzy).

**Architecture:** A migration creates the private `lesson-uploads` Storage bucket + adds `lessons.file_hash`/`source`. A new multipart **upload route** stores the file, computes a sha256, hard-blocks exact dups (409), and inserts a `draft` lesson. The **Upload UI orchestrates** the rest by calling the ALREADY-EXISTING `POST /api/teacher/lessons/parse` then `POST /api/teacher/quizzes/generate` (the engine fns are import-safe; no server-side duplication), running the ported **Jaccard `detectDuplicates`** fuzzy check (3-option modal) before quiz-gen. Two flat-list **library loaders** + pages (date filters: month/week/day) mirror the `loadGradebook` + gradebook-page auth pattern. A **quiz-manage route** does edit/publish/archive (publish = `status='published'` + `published_at`, the student-visibility gate).

**Tech Stack:** Next.js 16 App Router (async params), React 19, TS, Tailwind v4 (token-only), Supabase (admin client bypasses RLS — object guards are the backstop), Vitest 4 (+ jsdom for components). `unpdf`+`mammoth` already installed.

## Global Constraints
- **Auth chain on every teacher route:** `createServerSupabaseClient()` → `auth.getUser()` (401) → role ∈ `TEACHER_ROLES` (`teacher|school_admin|school_sysadmin|platform_admin`, from `STAFF_ROLES`) → `createAdminSupabaseClient()` → **`guardClassAccess(classId)` (the ONLY IDOR backstop — RLS does not protect admin reads); if it returns a NextResponse, return it.**
- **Page-level pattern (server components):** resolve `classId` from `searchParams.class`; if missing, `requireRole(['teacher'])` → `firstClassIdForTeacher(userId)` → `redirect('/<route>?class=' + firstId)`; then `guardClassAccess`; cold-start → `<EmptyState variant="just-getting-started" />`. Nav links carry `?class=` forward.
- **Token-only Tailwind v4** (no hardcoded hex / arbitrary `[var(--..)]`); content text `text-fg`. Build screens from the documented kit: `EmptyState`, `Card`(tone), `PageHeader`(title/kicker/accent/action), `SectionLabel`(tone). Pop-art: `border-2 border-sidebar-edge` + `shadow-sticker`.
- **"Assignments", never "Homework"** in UI copy.
- **Student-visibility gates:** a quiz is student-visible only at `status='published'` (+`published_at`). Upload-created lessons are `status='draft'`; parse sets `pending_review`. Never expose draft/pending to students.
- **Lessons soft-delete via `status='archived'`** (NO `archived_at` column in V2) — dedup/library queries filter `.neq('status','archived')`.
- **All user-facing strings are DRAFTS** → `STRINGS-FOR-BARB.md §Content Studio`; mark `(DRAFT)`.
- **Gates:** `npx tsc --noEmit` 0 · touched-file vitest green · (end) `npm test`, `npm run build` (tokens:check + WCAG-AA a11y), 0. Component tests start `// @vitest-environment jsdom` then `import '@/test/setup-dom';`.
- **Migration 0019 applies to NEW CORE only** (`pmdzxwppdlnddtnkoarc`) with explicit authorization; whole-branch review + Playwright preview before merge.

---

## Task 1: Migration 0019 — `lesson-uploads` bucket + `lessons.file_hash`/`source`

**Files:** Create `supabase/migrations/0019_content_studio.sql`; Test: extend `supabase/migrations/__tests__/migrations.test.ts`.

**Interfaces — Produces:** the private `lesson-uploads` Storage bucket; `lessons.file_hash text` (sha256, dedup); `lessons.source text default 'upload'` (`upload|ai_generated|manual`).

- [ ] **Step 1: Write the migration**
```sql
-- 0019_content_studio.sql
-- Content Studio Seg 1: lesson-upload storage + dedup/source columns.
-- Private bucket; the service-role admin client bypasses RLS, so NO storage.objects policies
-- are needed (mirrors V1 070_storage_buckets_provisioning). Idempotent.
insert into storage.buckets (id, name, public)
  values ('lesson-uploads', 'lesson-uploads', false)
  on conflict (id) do update set public = excluded.public;

alter table public.lessons
  add column if not exists file_hash text,
  add column if not exists source    text default 'upload';

-- Exact-dup lookup is WHERE teacher_id = ? AND file_hash = ?; index it.
create index if not exists lessons_teacher_file_hash_idx
  on public.lessons (teacher_id, file_hash);
```

- [ ] **Step 2: Extend the migrations test** — add to the existing structural test that 0019 declares the columns + bucket:
```ts
it('0019 adds lessons.file_hash + source and provisions the lesson-uploads bucket', () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, '0019_content_studio.sql'), 'utf-8');
  expect(sql).toMatch(/add column if not exists file_hash text/i);
  expect(sql).toMatch(/add column if not exists source\s+text default 'upload'/i);
  expect(sql).toMatch(/insert into storage\.buckets[\s\S]*'lesson-uploads'[\s\S]*false/i);
});
```
(Match the file's existing `MIGRATIONS_DIR`/`readFileSync` helpers — read the test header first.)

- [ ] **Step 3: Run** `npx vitest run supabase/migrations/__tests__/migrations.test.ts` → PASS. **Step 4: Commit.** (Do NOT apply to live DB — controller applies 0019 to NEW CORE with Marvin's auth before the smoke test.)

---

## Task 2: Dedup detector (`detectDuplicates`)

**Files:** Create `src/lib/lessons/duplicateDetect.ts`; Test: `src/lib/lessons/__tests__/duplicateDetect.test.ts`.

**Interfaces — Produces:**
```ts
export interface LessonRowLite { id: string; title: string | null; concept_tags: string[]; date?: string }
export interface DuplicateMatch { lesson: LessonRowLite; similarity: number; titleScore: number; tagScore: number }
export function tokenize(s: string | null | undefined): Set<string>;
export function jaccard(a: Set<string>, b: Set<string>): number;
export function detectDuplicates(candidate: { id?: string; title: string | null; concept_tags: string[] }, existing: ReadonlyArray<LessonRowLite>, threshold?: number): DuplicateMatch[];
```

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { detectDuplicates, tokenize, jaccard } from '@/lib/lessons/duplicateDetect';

describe('duplicateDetect', () => {
  it('jaccard: identical sets = 1, disjoint = 0, both empty = 0 (no signal)', () => {
    expect(jaccard(tokenize('photosynthesis basics'), tokenize('photosynthesis basics'))).toBe(1);
    expect(jaccard(tokenize('fractions'), tokenize('volcanoes'))).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
  it('flags a near-duplicate above threshold (0.6 = 0.6*title + 0.4*tags)', () => {
    const existing = [{ id: 'L1', title: 'Photosynthesis Basics', concept_tags: ['photosynthesis', 'chloroplast'] }];
    const m = detectDuplicates({ title: 'Photosynthesis Basics', concept_tags: ['Photosynthesis', 'light reactions'] }, existing);
    expect(m).toHaveLength(1);
    expect(m[0].lesson.id).toBe('L1');
    expect(m[0].similarity).toBeGreaterThanOrEqual(0.6);
  });
  it('does NOT flag a distinct lesson, and skips the candidate self-id', () => {
    const existing = [{ id: 'L1', title: 'The American Revolution', concept_tags: ['1776'] }];
    expect(detectDuplicates({ title: 'Cellular Respiration', concept_tags: ['ATP'] }, existing)).toHaveLength(0);
    expect(detectDuplicates({ id: 'L1', title: 'The American Revolution', concept_tags: ['1776'] }, existing)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: run (fail). Step 3: Implement** (port verbatim from V1 `lib/lessons/duplicateDetect.ts`):
```ts
// src/lib/lessons/duplicateDetect.ts
// Keyword Jaccard similarity for "is this lesson a duplicate?" — title (0.6) + concept tags (0.4).
// Pure + import-safe (no Next/Supabase). Ported from V1 lib/lessons/duplicateDetect.ts.
export interface LessonRowLite { id: string; title: string | null; concept_tags: string[]; date?: string }
export interface DuplicateMatch { lesson: LessonRowLite; similarity: number; titleScore: number; tagScore: number }

const STOPWORDS = new Set(['the','a','an','and','or','of','to','in','on','for','with','intro','introduction','lesson','unit','part','day','grade']);

export function tokenize(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s.toLowerCase().split(/[^a-z0-9À-ſ]+/).filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}
function computeSimilarity(candidate: { title: string | null; concept_tags: string[] }, existing: LessonRowLite) {
  const titleScore = jaccard(tokenize(candidate.title), tokenize(existing.title));
  const candTags = new Set<string>(); for (const t of candidate.concept_tags ?? []) for (const tok of tokenize(t)) candTags.add(tok);
  const exTags = new Set<string>(); for (const t of existing.concept_tags ?? []) for (const tok of tokenize(t)) exTags.add(tok);
  const tagScore = jaccard(candTags, exTags);
  return { titleScore, tagScore, similarity: 0.6 * titleScore + 0.4 * tagScore };
}
export function detectDuplicates(
  candidate: { id?: string; title: string | null; concept_tags: string[] },
  existing: ReadonlyArray<LessonRowLite>,
  threshold = 0.6,
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const ex of existing) {
    if (candidate.id && ex.id === candidate.id) continue;
    const { titleScore, tagScore, similarity } = computeSimilarity(candidate, ex);
    if (similarity >= threshold) matches.push({ lesson: ex, similarity, titleScore, tagScore });
  }
  return matches.sort((a, b) => b.similarity - a.similarity);
}
```
- [ ] **Step 4: run (pass). Step 5: tsc 0. Step 6: Commit.**

---

## Task 3: Lesson upload route (`POST /api/teacher/lessons/upload`)

**Files:** Create `src/app/api/teacher/lessons/upload/route.ts`; Test: `src/app/api/teacher/lessons/upload/__tests__/route.test.ts`.

**Interfaces — Consumes:** the auth chain + `guardClassAccess` (Task-0 existing), the bucket + `file_hash`/`source` (Task 1). **Produces:** `POST` multipart (`file`, `class_id`, `force?`) → `201 {lesson_id, file_url, file_name, file_type}` · `409 {duplicate:true, existing_lesson_id, existing_title, existing_created_at, message}` (exact file_hash, unless `force`) · `400` (bad type/missing) · `401/403/guard`.

- [ ] **Step 1: Write the failing test** (mock supabase + guards; assert 401/400-badtype/409-dup/201-ok). Mirror the trend-route test's mock style: stub `createServerSupabaseClient.auth.getUser`, a role lookup → 'teacher', `guardClassAccess` → null, `createAdminSupabaseClient` with `.from('lessons')` (existing-dup query) + `.storage.from('lesson-uploads').upload/getPublicUrl` + insert. Build a `FormData` with a `new File([bytes], 'l.pdf', {type:'application/pdf'})`.
```ts
// key assertions
it('409 on an exact file_hash duplicate (not forced)', async () => { /* existing row found → 409 duplicate:true */ });
it('201 inserts a draft lesson (source=upload, file_hash set) and returns lesson_id', async () => { /* … */ });
it('400 on a disallowed file type', async () => { /* .exe → 400 */ });
it('401 unauthenticated; 403 non-staff', async () => { /* … */ });
```

- [ ] **Step 2: run (fail). Step 3: Implement** (mirror the parse route's auth chain + V1 upload pattern):
```ts
// src/app/api/teacher/lessons/upload/route.ts
// POST multipart — store a lesson file in the private lesson-uploads bucket + create a draft lesson.
// Auth chain: getUser → TEACHER_ROLES → guardClassAccess(class_id) → admin write. Exact file_hash dup
// → 409 (unless force). The Upload UI then chains the EXISTING parse + quiz-generate routes (D2).
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

const ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const TEACHER_ROLES = new Set<string>(STAFF_ROLES);

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (profile as { role?: string } | null)?.role;
  if (!role || !TEACHER_ROLES.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const classId = form.get('class_id') as string | null;
  const force = form.get('force') === 'true';
  if (!file || !classId) return NextResponse.json({ error: 'Missing file or class_id' }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: 'Unsupported file type — upload a PDF, Word doc, or text file.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That file is too large (15 MB max).' }, { status: 400 });

  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash('sha256').update(buffer).digest('hex');

  if (!force) {
    const { data: dup } = await admin.from('lessons')
      .select('id, title, created_at')
      .eq('teacher_id', user.id).eq('file_hash', fileHash).neq('status', 'archived')
      .limit(1).maybeSingle();
    if (dup) {
      const d = dup as { id: string; title: string | null; created_at: string };
      return NextResponse.json({
        duplicate: true, existing_lesson_id: d.id, existing_title: d.title, existing_created_at: d.created_at,
        message: 'You already uploaded this file.',
      }, { status: 409 });
    }
  }

  const path = `${user.id}/${classId}/${Date.now()}_${file.name}`;
  const { error: upErr } = await admin.storage.from('lesson-uploads').upload(path, buffer, { contentType: file.type });
  if (upErr) return NextResponse.json({ error: 'Upload failed — try again.' }, { status: 500 });
  const { data: pub } = admin.storage.from('lesson-uploads').getPublicUrl(path);

  const { data: row, error: insErr } = await admin.from('lessons').insert({
    class_id: classId, teacher_id: user.id, file_name: file.name, file_url: pub.publicUrl,
    file_type: file.type, file_hash: fileHash, status: 'draft', source: 'upload',
  }).select('id, file_url, file_name, file_type').single();
  if (insErr || !row) return NextResponse.json({ error: 'Could not save the lesson.' }, { status: 500 });

  const r = row as { id: string; file_url: string; file_name: string; file_type: string };
  return NextResponse.json({ lesson_id: r.id, file_url: r.file_url, file_name: r.file_name, file_type: r.file_type }, { status: 201 });
}
```
- [ ] **Step 4: run (pass). Step 5: tsc 0. Step 6: Commit.**

---

## Task 4: Lesson Library — loader + page

**Files:** Create `src/lib/lessons/loadLessonLibrary.ts`; Modify `src/app/(teacher)/library/lessons/page.tsx` (replace stub); Create `src/app/(teacher)/library/lessons/_components/LessonLibrary.tsx`; Tests for the loader + the list component.

**Interfaces — Produces:**
```ts
export interface LessonLibRow { id: string; title: string; subject: string | null; grade_level: string | null; status: string; quiz_count: number; created_at: string }
export interface LessonLibrary { class_id: string; lessons: LessonLibRow[] }
export function loadLessonLibrary(admin: SupabaseClient, args: { classId: string }): Promise<LessonLibrary>;
```

- [ ] **Step 1: loader test** (stub admin like loadGradebook's test: `lessons` for the class (exclude archived) + `quizzes` counted per lesson_id). Assert: rows mapped, archived excluded, quiz_count per lesson, newest-first.
- [ ] **Step 2: run (fail). Step 3: Implement loader** — 2 batched queries (lessons where class_id, `.neq('status','archived')`, order created_at desc; quizzes where class_id → count by lesson_id), no internal auth (caller guards). Mirror `loadGradebook` style.
- [ ] **Step 4: loader passes. Step 5: component test** (`// @vitest-environment jsdom`): render `<LessonLibrary data={…} />` with 3 rows + a date filter; assert rows show title/status; the **filter** (search box + a month/week/day select) narrows the list; an empty list shows `<EmptyState>`; no banned words in any prose (`hasBannedWord`).
- [ ] **Step 6: Implement `LessonLibrary.tsx`** (`'use client'`): a flat list of `Card`-chrome rows (title `font-display`, `SectionLabel` status pill, subject·grade, quiz state); a top filter bar = a search `<input>` + a **date-granularity `<select>`** (All · This month · This week · Today — bucketed off `created_at`). Each row links to the lesson (`/library/lessons/[id]` is a later segment; for Seg 1 the row's primary action = "Make a quiz" if none + "Open quiz" if one, linking to the Quiz Library entry). Empty → `EmptyState variant="just-getting-started"` + an "Upload a lesson" link to `/upload?class=`. DRAFT strings → Barb.
- [ ] **Step 7: Implement `page.tsx`** (server) — the Global-Constraints page pattern: resolve `?class=`, `guardClassAccess`, `requireRole`, `createAdminSupabaseClient`, `loadLessonLibrary`, render `PageHeader title="Lesson Library" kicker="Your lessons" accent="brand"` + `<LessonLibrary data={…} />` (cold-start handled inside).
- [ ] **Step 8: tsc 0, both test files pass, append DRAFT strings, Commit.**

---

## Task 5: Quiz Library — loader + page + quiz-manage route (edit / publish / archive)

**Files:** Create `src/lib/quizzes/loadQuizLibrary.ts`; Create `src/app/api/teacher/quizzes/manage/route.ts`; Modify `src/app/(teacher)/library/quizzes/page.tsx`; Create `_components/QuizLibrary.tsx` (+ a quiz detail/edit panel); Tests for loader, route, component.

**Interfaces — Produces:**
- `loadQuizLibrary(admin,{classId}) → { class_id, quizzes: QuizLibRow[] }`, `QuizLibRow { id, title, lesson_title: string|null, status, question_count, published_at: string|null, created_at }`.
- `POST /api/teacher/quizzes/manage` body `{ quiz_id, action: 'publish'|'unpublish'|'archive'|'edit', title?, questions?: {id, question_text, choices?, rubric?}[] }` → 200. **publish** = `status='published', published_at=now()` (the student-visibility gate); **edit** = update title + per-question text/choices/rubric (no engine re-run); **archive** = `status='archived'`. Auth: getUser → role → resolve quiz→class_id → `guardClassAccess` (mirror the existing override route).

- [ ] **Step 1: route test** — 401/403; publish sets status+published_at; edit updates questions; archive sets archived; guard enforced (resolve quiz's class_id then `guardClassAccess`). Mirror the gradebook override route's test mock.
- [ ] **Step 2: run (fail). Step 3: Implement the manage route** (auth chain; load quiz → its class_id → `guardClassAccess`; switch on action; `published_at` only set on publish; fail-loud on write error).
- [ ] **Step 4: loader test + impl** (2 queries: quizzes for class `.neq('status','archived')` + question counts; resolve lesson_title via the lessons map; order published_at desc nulls last then created_at).
- [ ] **Step 5: component test + impl** `QuizLibrary.tsx` (`'use client'`): flat list (title, lesson, `SectionLabel` status [Draft/Published], #questions, published date); same search + date filter as the Lesson Library; row → a detail/edit panel (mirror the gradebook drill-in panel pattern: dialog, focus-trap, Escape) to **edit** title + each question's text/choices/rubric and **Publish** (`POST manage action=publish`) / unpublish / archive. After a write, `router.refresh()`. Publishing flips the pill to "Published" — copy: "Published — students can see it now." (DRAFT). Empty → `EmptyState`.
- [ ] **Step 6: page.tsx** (server, the page pattern) → `PageHeader title="Quiz Library"` + `<QuizLibrary data={…} />`.
- [ ] **Step 7: tsc 0, all tests pass, DRAFT strings → Barb, Commit.**

---

## Task 6: Upload UI — the orchestrator (upload → auto-parse → fuzzy dedup → auto-quiz)

**Files:** Modify `src/app/(teacher)/upload/page.tsx` (replace stub: server page = the Global-Constraints pattern, renders `<UploadStudio classId={classId} />` + needs the teacher's existing lessons-lite for the fuzzy check — pass them in or fetch client-side); Create `_components/UploadStudio.tsx`; Test for the component.

**Interfaces — Consumes:** `POST /api/teacher/lessons/upload` (Task 3), the EXISTING `POST /api/teacher/lessons/parse` + `POST /api/teacher/quizzes/generate`, `detectDuplicates` (Task 2).

- [ ] **Step 1: component test** (`// @vitest-environment jsdom`, mock `fetch` per-URL): (a) happy path — choosing a file drives upload→parse→quiz and ends on a "Quiz ready" state with links; (b) **exact dup** — upload returns 409 → a "You already uploaded this file" modal with "Open it" / "Upload anyway"; (c) **fuzzy dup** — after parse, `detectDuplicates` finds a match → the 3-option modal ("Use that one" / "Create anyway" / "Cancel") gates quiz-gen; (d) a bad-type file shows the inline error. Assert progress labels + no banned words.
- [ ] **Step 2: run (fail). Step 3: Implement `UploadStudio.tsx`** (`'use client'`):
  - Drag-drop + file input (accept `.pdf,.docx,.txt`). Class context from props.
  - **Flow:** `POST /upload` (multipart) → on 409 `{duplicate}` show the exact-dup modal (Open it → link to library; Upload anyway → re-POST with `force=true`). On 201 → `POST /lessons/parse {lesson_id}` (status: "Reading your lesson…") → on success run `detectDuplicates({title: parsed.title, concept_tags: parsed.key_concepts.map(formatTag)}, existingLessons)`; if matches → 3-option modal (Use that one → link; Create anyway → continue; Cancel → stop). Then `POST /quizzes/generate {lesson_id}` (status: "Building a quiz…") → done state: "Lesson added + quiz drafted" with links to the Lesson/Quiz Library (carry `?class=`).
  - Progress states (uploading → reading → checking → building → done), error states, all token-only, `EmptyState`/`Card`/`PageHeader`/`SectionLabel` chrome + the pop-art sticker buttons. Reduced-motion-safe (no required motion). DRAFT strings → Barb.
- [ ] **Step 4: run (pass). Step 5: page.tsx** server wrapper (page pattern; fetch the teacher's lessons-lite for the class — `id, title, parsed_content.key_concepts, status` excluding archived — and pass to `UploadStudio` for the fuzzy check). Step 6: tsc 0, DRAFT strings, Commit.

---

## Final verification (whole branch, before review)
- [ ] `npm test` green · `npx tsc --noEmit` 0 · `npm run build` 0 (tokens:check + WCAG-AA a11y).
- [ ] Whole-branch adversarial review (`scripts/review-package <merge-base> HEAD`) → fix Critical/Important.
- [ ] Controller applies **migration 0019** to NEW CORE (`pmdzxwppdlnddtnkoarc`) with Marvin's authorization; reseed/confirm the bucket; restart the dev server.
- [ ] Playwright preview (logged-in teacher) of the upload flow + both libraries + a publish → Marvin sign-off before merge.
