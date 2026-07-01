# Student Improvements — B Spec

**Date:** 2026-06-29  
**Status:** READY FOR PLAN  
**Migration:** none

---

## Problem

V2 has the active-learning flows (assignment player, quiz runner, chapter test) but the student's
reflective layer is almost completely absent. Students can only see 2 High-Five notes on the
dashboard and have no growth page at all. The student experience ends at "do the work" with
nothing feeding the coach relationship back.

V1 reference:
- `/student/hugs` — full notes wall, paginated, share-with-parent toggle
- `/student/progress` — `StudentProgressV2` growth/learning-style/journey page

---

## Scope

Three features. No migration. All server components unless browser state is required.

### Feature 1 — Student Notes Wall (`/student/notes`)

A dedicated page listing all High-Fives the student has received, newest first.

**Route:** `/student/notes`  
**Data:** `high_fives` WHERE student_id = auth.uid(), order by created_at desc, paginate 20/page  
**Auth:** standard server Supabase client is enough — `high_fives` has student-read RLS. Load via admin client if RLS doesn't support it (fallback).  
**Nav:** Add "My Notes" link in the student layout nav. Always visible (shows "No notes yet" empty state). Dashboard: if `totalCount > 2`, show a "See all →" link below the two preview notes.

**Card anatomy:**  
- Note text (warm, full width)  
- Date: relative human label — "Last week" / "June 27" (use `formatRelative` or hand-rolled `shortDate`)  
- No score, no band, no diagnostic data

**Empty state:** "Your teacher hasn't sent a note yet — keep up the great work!" (Barb to gate copy).

**Share-with-parent toggle:** DEFERRED to C (parent shell). Don't build it now.

---

### Feature 2 — Student Growth Page (`/student/growth`)

A lightweight "how I'm doing" page. Coach posture, no diagnostic vocabulary, no raw numbers.

**Route:** `/student/growth`  
**Nav:** Add "How I'm doing" link in student layout nav (below "My Notes").

**Content (top to bottom):**

1. **Lead sentence** — dynamic, coach-authored. Examples:
   - "You've been putting in real effort lately — it shows."
   - "You're making progress. Here's where you stand."
   Built from a small deterministic lookup (no AI, no LLM — just a warm sentence based on grade trend direction: climbing/steady/sliding). Barb to gate final copy.

2. **Grade trend sparkline** — reuse `GradeTrendSparkline` component (already exists, WCAG-AA token SVG). Digit-free. Below the sparkline, one soft direction sentence: "Your grades have been climbing" / "Holding steady" / "A little uneven lately — you've got this." (Barb to gate.)

3. **Skill highlights** — per skill from `skill_learning_state`. Translate `mastery_level` enum → student-facing label using a new pure helper `studentSkillLabel(level)`:
   - `'reteach'` → "Building strength"
   - `'on_track'` → "Solid"  
   - `'enrichment'` → "Excelling"
   
   Show skill name + label. Max 6 skills (show highest-confidence first). No raw CL score, no cl_verb, no band enum. No confidence number. No peer comparison.

4. **Recent note teaser** — if any High-Fives exist, show the most recent note + "See all your notes →" link to `/student/notes`. Quiet if none.

**Four-audience enforcement:**
- Import and run `leakGuard` on the lead sentence and direction sentence before render (belt-and-suspenders; these are deterministic strings but good practice).
- `studentSkillLabel` NEVER returns a teacher CL verb ('reteach', 'on_track', 'enrichment' must not appear in the output).
- No raw % on skills. No raw risk score. No band enum in JSX.

**Data loading:** New server function `loadStudentGrowth(adminClient, studentId)` returns:
```ts
{
  gradeDirection: 'climbing' | 'steady' | 'sliding' | 'cold';
  skills: Array<{ skillName: string; level: 'reteach' | 'on_track' | 'enrichment'; confidence: number }>;
  latestHighFiveText: string | null;
  totalHighFiveCount: number;
}
```
Reads from `skill_learning_state` (admin client, min 2 signal_count filter to avoid cold-start noise)
and `loadStudentGradeTrend` (already exists) for direction.

---

### Feature 3 — Dashboard Improvements

The existing dashboard (`src/app/(student)/student/dashboard/page.tsx`) currently shows:
- A greeting heading
- Up to 2 High-Fives via `HighFiveNote`

Add:

1. **"Next up" assignment card** — the student's oldest incomplete assignment (status not 'submitted' / 'graded'). Shows assignment title + "Start" button → `/student/assignments/[id]/play`. If none, the section is quiet (no empty state card). Pull from existing `GET /api/attempts/homework-draft` pattern or a new lightweight server query.

2. **"See all" link** — below the 2 High-Five notes, if `count > 2`, show "See all X notes →" link to `/student/notes`.

---

## Out of Scope

- Share-with-parent toggle (C)
- Quiz/assignment history page
- Learning-style view
- Achievement badges
- Any leaderboard or peer comparison (NEVER)
- Any AI-generated growth copy (deterministic strings only for this epic)

---

## Constraints (binding)

- Four-audience: student surfaces NEVER show mastery-band enum, CL verbs, raw risk numbers, peer data.
- All copy → `STRINGS-FOR-BARB.md §Student Improvements (B)`. Barb gates UI strings.
- Token classes only (no hardcoded hex). Content text = `text-fg`.
- No new migration.
- `leakGuard` on any dynamic string heading or body text on student surfaces.
- Auth chain: `createServerSupabaseClient()` → `auth.getUser()` → student guard → admin client for restricted tables.

---

## Task Map

| Task | Deliverable |
|------|-------------|
| 1 | `loadStudentGrowth` loader + `studentSkillLabel` helper + tests |
| 2 | `GET /api/student/growth` route + `/student/growth` page |
| 3 | `/student/notes` page + "See all" link on dashboard |
| 4 | Dashboard "Next up" assignment card |
| 5 | Student nav: add "My Notes" + "How I'm doing" links |
| 6 | `leakGuard` coverage + final wiring |

(Tasks may be combined or split in the plan based on size.)
