# Drill-In Completions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the three dead affordances on the teacher One-Student drill-in (Barb's feedback): "Add note" (per-student private teacher notes — new store), the "Worth a look" card's click-through to evidence, and the "Open Assignments" destination.

**Architecture:** Task 1 adds the missing backing store (migration 0032 `student_notes`, deny-by-default RLS) + one API route (POST add / GET list-own, full house auth chain). Task 2 enables the header button with an `AddNoteModal` mirroring `QuickHighFiveModal`. Task 3 wires the two navigation gaps (quiet evidence link on the coach card; `/gradebook` as the Open-Assignments destination in BOTH render sites) + Barb strings.

**Tech Stack:** Next.js 16 App Router under `src/`, Supabase admin client (RLS bypassed — guards are the backstop), vitest 4 (`// @vitest-environment jsdom` + `import '@/test/setup-dom';` for component tests), Tailwind v4 token classes.

## Global Constraints

- Branch `feat/drill-in-completions` (already checked out, off `main` `6ed5560`).
- **Auth chain on the new route (exact house order):** `createServerSupabaseClient()` → `getUser()` (401) → STAFF_ROLES gate (403) → `guardStudentAccess(studentId)` (IDOR; the admin client bypasses RLS — the guard IS the backstop) → admin queries. Mirror `src/app/api/teacher/high-fives/send/route.ts`.
- **Privacy: notes are PRIVATE TO THE AUTHOR.** Every SELECT filters `.eq('author_id', user.id)` — never return another teacher's notes. Four-audience: this data must have NO student/parent read path anywhere (deny-by-default RLS + teacher-only route).
- **Migration 0032 is a FILE in this branch only — do NOT apply it to any live database** (Marvin authorizes application at ship time).
- Note length cap 2000 chars (matches `homework_attempts.teacher_notes`' MAX_NOTES).
- Token classes only (`border-sidebar-edge`, `bg-bg`, `text-fg`, `text-fg-muted`, `shadow-sticker-lg`…); no hex; content text `text-fg`.
- User-facing words: "Assignments" never "Homework". All new strings → `STRINGS-FOR-BARB.md §Drill-in completions`.
- Coach posture on the Worth-a-look link: a quiet invitation ("See what's behind this →"), not a shouting button.
- TDD failing-first; commit with explicit paths (NEVER `git add -A`).

## Verified current-code facts (do not re-derive)

- `IdentityHeader.tsx` already receives `studentId` + `classId` (page.tsx:107-115); "Add note" (:76-84) and "Open Assignments ›" (:85-93) are hard-`disabled` buttons; High Five (:69-75) opens `QuickHighFiveModal` via `useState` — the pattern to mirror.
- `QuickHighFiveModal.tsx`: `role="dialog" aria-modal` fixed overlay, backdrop + × close, 422-violations list, generic error, success `role="status"` + 2s auto-close, `canSend` gating. Tests at `__tests__/QuickHighFiveModal.test.tsx`.
- `priorityCta.ts` kinds: `review-risk`(#at-risk) / `flag-reteach`(/gradebook) / `leave-note`(#pattern) / `open-assignments`(no anchor). `PriorityRecommendation.tsx` renders `open-assignments` as a dead `<span title="Coming soon">`; all other kinds render `<Link>`.
- `CoachObservationCard.tsx` (37 lines): `motion.div id="at-risk"` wrapping `Card tone` + `SectionLabel` + line + suggestion. Zero interactivity today.
- `QuizDetailSection.tsx:42`: `<section aria-label="Quiz performance">` — **no id** (Task 3 adds `id="quiz-detail"`). `SkillMapMatrix.tsx:103` has `id="skill-map"`.
- No per-student note store exists (only per-attempt `homework_attempts.teacher_notes` / `quiz_attempts.teacher_notes`). Latest migration: `0031_support_tickets.sql` → new file is **0032**. RLS pattern to copy: `alerts` in `0017_teacher_completion.sql` (RLS on; `service_role FOR ALL USING(true) WITH CHECK(true)`; NO authenticated policies; explicit GRANTs). Column conventions: `high_fives` (0017).
- One-Student page: server component; `guardStudentAccess(studentId)` → `redirect('/roster')`; loads signals/identity/trend/quizDetails in parallel; `classId = searchParams.class`.

## File Structure

- Create: `supabase/migrations/0032_student_notes.sql`
- Create: `src/app/api/teacher/students/notes/route.ts` (POST + GET)
- Create: `src/app/api/teacher/students/notes/__tests__/route.test.ts`
- Create: `src/app/(teacher)/students/[studentId]/_components/AddNoteModal.tsx`
- Create: `src/app/(teacher)/students/[studentId]/__tests__/AddNoteModal.test.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx` (enable both buttons)
- Modify: `src/app/(teacher)/students/[studentId]/_components/CoachObservationCard.tsx` (evidence link)
- Modify: `src/app/(teacher)/students/[studentId]/_components/WholeChildRail.tsx` (pass `hasQuizEvidence`)
- Modify: `src/app/(teacher)/students/[studentId]/page.tsx` (pass `hasQuizEvidence` into the rail)
- Modify: `src/app/(teacher)/students/[studentId]/_components/QuizDetailSection.tsx` (add `id="quiz-detail"`)
- Modify: `src/app/(teacher)/students/[studentId]/_components/PriorityRecommendation.tsx` (open-assignments → Link)
- Modify: `src/app/(teacher)/students/[studentId]/_lib/priorityCta.ts` (open-assignments anchor `/gradebook`)
- Modify: `STRINGS-FOR-BARB.md`

---

### Task 1: `student_notes` store + API route

**Files:**
- Create: `supabase/migrations/0032_student_notes.sql`
- Create: `src/app/api/teacher/students/notes/route.ts`
- Test: `src/app/api/teacher/students/notes/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient`/`createAdminSupabaseClient` (`@/lib/supabase/server`), `STAFF_ROLES` (`@/lib/auth/roles`), `guardStudentAccess` (`@/lib/auth/guards`).
- Produces (LOCKED for Task 2):
  - `POST /api/teacher/students/notes` body `{ student_id: string, class_id?: string | null, text: string }` → 200 `{ ok: true, id }` | 400 `{ error }` (missing/empty/too long >2000) | 401/403 | guard response.
  - `GET /api/teacher/students/notes?studentId=…` → 200 `{ notes: [{ id, note_text, created_at }] }` (caller's OWN notes only, newest first, limit 5) | 400/401/403 | guard response.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/0032_student_notes.sql`:

```sql
-- 0032_student_notes.sql — private per-student teacher notes.
-- Backs the One-Student drill-in "Add note" button (deferred since Epic 3 —
-- "no backing store"). Notes are PRIVATE TO THE AUTHORING TEACHER: the API
-- filters author_id = caller on every read. Deny-by-default RLS (the `alerts`
-- pattern, 0017): service_role only — app routes enforce STAFF_ROLES +
-- guardStudentAccess + author scoping. NO student/parent read path exists
-- (four-audience: this table must never surface outside teacher routes).

CREATE TABLE IF NOT EXISTS public.student_notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id   uuid        REFERENCES public.classes(id) ON DELETE SET NULL,
  student_id uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  note_text  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_notes_lookup_idx
  ON public.student_notes (student_id, author_id, created_at DESC);

ALTER TABLE public.student_notes ENABLE ROW LEVEL SECURITY;

-- service_role full access; NO authenticated policies (deny-by-default).
-- DROP-first: CREATE POLICY has no IF NOT EXISTS (house idempotency pattern).
DROP POLICY IF EXISTS student_notes_service_all ON public.student_notes;
CREATE POLICY student_notes_service_all ON public.student_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON public.student_notes TO service_role;
```

(Do NOT apply to any live DB — file only.)

- [ ] **Step 2: Write the failing route test**

`src/app/api/teacher/students/notes/__tests__/route.test.ts` — mirror the mocking idiom of `src/app/api/teacher/high-fives/send/__tests__/route.test.ts` (hoisted `vi.mock` factories for `@/lib/supabase/server`, `@/lib/auth/guards`, faithful `@/lib/auth/roles`). Cases:

```ts
// @vitest-environment node
// Idiom: mirror high-fives/send route test mocks. The admin-client fake needs
// a 'users' row { role: 'teacher' } and a chainable student_notes builder that
// records inserts and select filters (capture .eq calls — the author_id
// scoping assertion is the point of this suite).
import { describe, it, expect, vi, beforeEach } from 'vitest';
// …mock setup mirroring high-fives/send…

describe('POST /api/teacher/students/notes', () => {
  it('401 when unauthenticated', async () => { /* getUser → null → 401 */ });
  it('403 for non-staff roles', async () => { /* role 'student' → 403 */ });
  it('400 on missing student_id / empty text / text > 2000 chars', async () => { /* three sub-asserts */ });
  it('IDOR: returns the guard response and never inserts when guardStudentAccess denies', async () => {
    // guardStudentAccess -> Response(403); expect insert NOT called
  });
  it('inserts with author_id = caller and returns { ok: true, id }', async () => {
    // assert the insert payload: student_id, author_id === user.id, note_text trimmed,
    // class_id passed through (null when absent), school_id resolved from the student row
  });
});

describe('GET /api/teacher/students/notes', () => {
  it('400 without studentId', async () => {});
  it('IDOR: guard response short-circuits the query', async () => {});
  it('AUTHOR-PRIVACY: the select filters author_id = caller (never another teacher\'s notes)', async () => {
    // assert the recorded .eq('author_id', user.id) call happened
  });
  it('returns newest-first notes limited to 5', async () => {});
});
```

(Write the full runnable test with the real mock plumbing — the sketch above lists the REQUIRED cases and load-bearing assertions; keep them verbatim.)

**Mock-plumbing requirements (pre-code review findings — without these, two tests pass vacuously):**
- The chainable recorder must capture `.order(...)` and `.limit(...)` ARGS — the "newest-first / limit 5" test asserts the RECORDED `.order('created_at', { ascending: false })` and `.limit(5)` calls (the fake returns whatever it's told, so returned-data assertions prove nothing).
- The `users` table is hit TWICE with different shapes: requireStaff's `select('role').eq('id', <caller>)` AND the student lookup `select('school_id').eq('id', <studentId>)` — the fake must discriminate on the select/eq arguments and serve both, or the happy-path school_id assertion fails against its own plumbing.

- [ ] **Step 3: Run to verify it fails** — `npx vitest run "src/app/api/teacher/students/notes"` → module not found.

- [ ] **Step 4: Implement the route**

`src/app/api/teacher/students/notes/route.ts`:

```ts
// Private per-student teacher notes (drill-in "Add note").
// PRIVACY CONTRACT: notes are visible ONLY to their author — every SELECT
// filters author_id = caller. Auth mirrors high-fives/send:
// getUser → STAFF_ROLES → guardStudentAccess (IDOR; RLS is NOT the backstop).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardStudentAccess } from '@/lib/auth/guards';

const MAX_NOTE = 2000;

async function requireStaff() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { fail: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const admin = createAdminSupabaseClient();
  const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (roleRow as { role?: string } | null)?.role;
  if (!role || !new Set<string>(STAFF_ROLES).has(role)) {
    return { fail: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user, admin };
}

export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if ('fail' in ctx) return ctx.fail;
  const { user, admin } = ctx;

  let body: { student_id?: string; class_id?: string | null; text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const studentId = body.student_id;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!studentId || text.length === 0 || text.length > MAX_NOTE) {
    return NextResponse.json({ error: 'A note needs between 1 and 2000 characters.' }, { status: 400 });
  }

  const guard = await guardStudentAccess(studentId);
  if (guard) return guard;

  const { data: student } = await admin.from('users').select('school_id').eq('id', studentId).maybeSingle();
  const schoolId = (student as { school_id?: string } | null)?.school_id ?? null;

  const { data: row, error: insErr } = await admin.from('student_notes')
    .insert({
      student_id: studentId,
      author_id: user.id,
      // string-validate like high-fives/send does — a non-string here is a
      // Postgres type error → 500, and junk FK refs shouldn't be storable
      class_id: typeof body.class_id === 'string' ? body.class_id : null,
      school_id: schoolId,
      note_text: text,
    })
    .select('id')
    .single();
  if (insErr || !row) return NextResponse.json({ error: 'Could not save the note.' }, { status: 500 });
  return NextResponse.json({ ok: true, id: (row as { id: string }).id });
}

export async function GET(req: NextRequest) {
  const ctx = await requireStaff();
  if ('fail' in ctx) return ctx.fail;
  const { user, admin } = ctx;

  const studentId = new URL(req.url).searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'Missing studentId' }, { status: 400 });

  const guard = await guardStudentAccess(studentId);
  if (guard) return guard;

  const { data } = await admin.from('student_notes')
    .select('id, note_text, created_at')
    .eq('student_id', studentId)
    .eq('author_id', user.id) // PRIVACY: own notes only
    .order('created_at', { ascending: false })
    .limit(5);
  return NextResponse.json({ notes: data ?? [] });
}
```

- [ ] **Step 5: Run tests to verify they pass** — `npx vitest run "src/app/api/teacher/students/notes"` → all green. `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0032_student_notes.sql src/app/api/teacher/students/notes/
git commit -m "feat(drill-in): student_notes store + author-private notes API (migration 0032, NOT applied)"
```

---

### Task 2: AddNoteModal + enable the header button

**Files:**
- Create: `src/app/(teacher)/students/[studentId]/_components/AddNoteModal.tsx`
- Modify: `src/app/(teacher)/students/[studentId]/_components/IdentityHeader.tsx` (the "Add note" button only)
- Test: `src/app/(teacher)/students/[studentId]/__tests__/AddNoteModal.test.tsx`

**Interfaces:**
- Consumes: Task 1's route contract; `QuickHighFiveModal.tsx` as the structural template (props `{ studentId, classId, studentName, isOpen, onClose }`, dialog markup, close/backdrop, busy/error states, token classes).
- Produces: `<AddNoteModal studentId classId studentName isOpen onClose />`.

- [ ] **Step 1: Write the failing component test** (`// @vitest-environment jsdom` + `import '@/test/setup-dom';` first; stub global fetch):
  - renders nothing when closed; dialog with `aria-modal` when open
  - **closed → NO fetch fires** (the effect is gated on isOpen — pins against the stray-GET-per-page-view bug)
  - on open, GETs `/api/teacher/students/notes?studentId=…` and lists prior notes ("Your earlier notes"); empty list → no such section
  - Save disabled when empty or >2000 chars; busy label "Saving…"
  - successful POST shows `role="status"` confirmation, refreshes the list, clears the textarea
  - non-ok POST shows the friendly error, keeps the draft text
  - **privacy copy present: "Only you can see these notes."**
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement the modal** — mirror `QuickHighFiveModal` structure/markup/tokens exactly (fixed overlay `bg-fg/30 backdrop-blur-sm`, panel `max-w-sm rounded-xl border-2 border-sidebar-edge bg-bg p-5 shadow-sticker-lg`, × + Cancel + Save buttons, `data-testid="note-save"`). Differences: on open, `useEffect` — **GATED on `isOpen`** (`if (!isOpen) return;` with `[isOpen, studentId]` deps; the template's hooks-then-`return null` structure means an ungated effect fires a stray authenticated GET on every drill-in page view with the modal closed) — fetches the caller's own notes (newest-first list, `text-sm text-fg`, date via `toLocaleDateString`); POST body `{ student_id, class_id, text }`; after success stay open (show "Saved." status + refreshed list) rather than auto-close — a teacher may add context right after reading their old notes. Strings (Barb drafts): title `Add a note about {studentName}`, subtitle `Only you can see these notes.`, textarea placeholder `What do you want to remember?`, buttons `Cancel` / `Save note` / `Saving…`, status `Saved.`, list heading `Your earlier notes`, error `Something went wrong — your note wasn’t saved. Try again.` (curly apostrophe — house copy convention)
- [ ] **Step 4: Enable the button in `IdentityHeader.tsx`** — replace the disabled "Add note" stub with the High-Five pattern: `const [noteOpen, setNoteOpen] = useState(false)`, active styling matching the High Five button (drop `disabled`/`opacity-50`/`title="Coming soon"`; use `text-fg` + hover idiom of the sibling), render `<AddNoteModal … isOpen={noteOpen} onClose={() => setNoteOpen(false)} />`. Update the file-header comment (only "Open Assignments" remains deferred — until Task 3).
- [ ] **Step 5: Run** `npx vitest run "src/app/(teacher)/students"` + `npx tsc --noEmit`. NOTE: `__tests__/page.test.tsx` has NO disabled-state assertion today (its only adjacent check is `toContain('Open Assignments')` at :144-147, which passes before and after) — there is nothing to update in Task 2; the new enabled/link assertions are ADDED in Task 3 Step 1.
- [ ] **Step 6: Commit** — explicit paths.

---

### Task 3: Worth-a-look click-through + Open Assignments destination + Barb strings

**Files:**
- Modify: `CoachObservationCard.tsx`, `WholeChildRail.tsx`, `page.tsx`, `QuizDetailSection.tsx`, `PriorityRecommendation.tsx`, `_lib/priorityCta.ts`, `IdentityHeader.tsx` (the "Open Assignments" button), `STRINGS-FOR-BARB.md`
- Tests: extend `_components/__tests__/CoachObservationCard.test.tsx` and `_components/__tests__/WholeChildRail.test.tsx` (NOTE: these live under `_components/__tests__/`, NOT the top-level `__tests__/` — extend, don't duplicate), `_lib/__tests__/priorityCta.test.ts`, `__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `#skill-map` (exists), new `id="quiz-detail"` on QuizDetailSection.
- Produces: `CoachObservationCard` gains optional prop `evidenceHref?: string | null` — renders a quiet `<a>` link `See what's behind this →` when non-null. `WholeChildRail` gains `evidenceHref` prop and passes it through. `priorityCta`'s `open-assignments` kind gains `anchor: '/gradebook'`.

- [ ] **Step 1: Failing tests first:**
  - `CoachObservationCard.test.tsx`: with `evidenceHref="#quiz-detail"` → an accessible link "See what's behind this" with that href; with `evidenceHref={null}` → no link (quiet default preserved); ADD a page-level case: cold-start (no quiz attempts AND empty `per_skill_cl`) → NO link rendered anywhere (the null fallback).
  - `priorityCta.test.ts`: the `open-assignments` fallback now carries `anchor: '/gradebook'` (update the existing case 4 expectation).
  - `WholeChildRail.test.tsx`: `PriorityRecommendation` with the open-assignments CTA renders a real link to `/gradebook` (no more `title="Coming soon"` span).
  - `page.test.tsx`: the "Open Assignments" fallback CTA is now a link, not a disabled button; and the header's Open Assignments button navigates (anchor with href `/gradebook` or `/gradebook?class=…`).
- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement:**
  - `QuizDetailSection.tsx`: add `id="quiz-detail"` to the `<section aria-label="Quiz performance">`.
  - `CoachObservationCard.tsx`: optional `evidenceHref` prop; when present render below the suggestion: `<a href={evidenceHref} className="mt-2 inline-block text-sm font-semibold text-brand hover:underline">See what's behind this →</a>` (coach posture: one quiet invitation; no new motion).
  - `page.tsx`: compute the target with a NULL cold-start fallback — the id `#skill-map` only exists when skills render (SkillMapMatrix early-returns WITHOUT the id when empty), so a dangling href would rebuild the exact dead click this task kills:
    ```ts
    const evidenceHref = quizAttempts.length > 0 ? '#quiz-detail'
      : signals.per_skill_cl.length > 0 ? '#skill-map'
      : null; // cold-start: the coach just said there's nothing behind this yet — no link (posture)
    ```
    (the loaded quiz details variable is literally `quizAttempts`, page.tsx:61) and pass through `WholeChildRail` → `CoachObservationCard`.
  - `priorityCta.ts`: fallback becomes `{ kind: 'open-assignments', label: 'Open Assignments', anchor: '/gradebook' }` (update the file-header comment).
  - `PriorityRecommendation.tsx`: delete the dead-span special case — `open-assignments` now flows through the normal `<Link>` branch (keep the comment explaining the history in one line).
  - `IdentityHeader.tsx`: replace the disabled "Open Assignments ›" button with a `<Link href={classId ? `/gradebook?class=${classId}` : '/gradebook'}>` styled like the active sibling buttons; remove the last "deferred" note from the file-header comment.
- [ ] **Step 4: Barb strings** — append to `STRINGS-FOR-BARB.md`:

```markdown
## Drill-in completions (One-Student page) — 2026-07-01

| Where | Draft string |
|---|---|
| Add-note modal title | Add a note about {student} |
| Privacy subtitle | Only you can see these notes. |
| Textarea placeholder | What do you want to remember? |
| Buttons | Cancel · Save note · Saving… |
| Saved status | Saved. |
| Earlier-notes heading | Your earlier notes |
| Save error | Something went wrong — your note wasn’t saved. Try again. |
| Worth-a-look link | See what's behind this → |

NOTE for Barb: the "Open Assignments ›" button now opens the Gradebook (assignments live there as columns — same destination as the Reinforce flow). If the label should say where it goes (e.g. "See Assignments in Gradebook ›"), that's a one-line copy change.
```

- [ ] **Step 5: Full gates** — `npx vitest run` (full suite), `npx tsc --noEmit`, `npm run build`.
- [ ] **Step 6: Commit** — explicit paths.

---

## Self-review notes

- Barb items covered: Add a note (Tasks 1-2), Worth-a-look click (Task 3), Open Assignments (Task 3). The migration is file-only until Marvin authorizes live application.
- Type consistency: route contract (Task 1 Produces) matches the modal's fetch/POST (Task 2); `evidenceHref` threaded page → rail → card with one name.
- The privacy contract (author-only reads) is pinned by a dedicated test assertion on the recorded `.eq('author_id', …)` filter — the admin client bypasses RLS, so that filter is the only backstop.
