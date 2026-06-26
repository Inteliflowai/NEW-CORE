# School-Admin Pages — Grounding Synthesis

> Gathered 2026-06-26 by 3 parallel read-only Explore sweeps. V2 = `C:/users/inteliflow/NEW-CORE` (build target). V1 = `C:/users/inteliflow/core` (READ-ONLY reference). All claims file:line-cited in the agent reports; key facts distilled here.

## 0. The opportunity
V2's `(school-admin)` route group exists but is a **placeholder** ("coming soon") with **no app shell**. For a paying/pilot school whose administrator logs in, that's a credibility hole. Build real, operational school-admin pages.

## 1. V2 current state
- **Route group** `src/app/(school-admin)/`: `layout.tsx` guards with `requireRole(SCHOOL_ADMIN_ROLES)` (`['school_admin','school_sysadmin','platform_admin']`, `src/lib/auth/roles.ts:10`), wraps in bare `RoleLayout` (`data-role="admin" data-intensity="calm"`), single hardcoded nav link to `/admin/dashboard`. Only `admin/dashboard/page.tsx` exists = placeholder.
- **No shell** (no TeacherShell equivalent) — just `RoleLayout` (bare header + ◆ mark).
- **Guard** `guardSchoolAdmin()` (`src/lib/auth/guards.ts:50-61`) → `{ schoolId, role, userId, isPlatformAdmin }`. **platform_admin → schoolId null** (unrestricted; callers MUST check `isPlatformAdmin` before `.eq('school_id', schoolId)`). This is the IDOR backstop; data path is `createAdminSupabaseClient()` (RLS-bypassed) — **so RLS gating on alerts/high_fives/audit does NOT block server-side reads scoped by the guard**.
- **No school-level loaders yet** (net-new). Pattern to mirror: `src/lib/teacher/teacherClasses.ts` + `src/app/api/teacher/classes/route.ts:56-66` (role-branched `.eq('school_id', schoolId)`).
- **Shell to mirror:** `(teacher)/_components/{TeacherShell,TeacherSidebar,TeacherTopbar}.tsx` (pop-art cobalt rail + `border-sidebar-edge`/`bg-sidebar` tokens, `sidebar-dots`/`sidebar-glow`, logo plate, `SidebarNav` via `navConfig.ts`, mobile drawer, topbar with `pageTitleFor` + greeting + avatar). `SidebarNav`/`navConfig.ts` drive the nav sections.
- **Super-admin reference (real pages):** `(super-admin)/provision` (form → `POST /api/admin/provision-trial`) + `(super-admin)/schools` (server page: admin client → `schools` list → per-school card). Server-page loader pattern = admin client + render; platform-wide (no school scope).

## 2. V2 data model (NO migration needed — admin client reads, guard scopes)
- **`schools`** (`0001:13-37`): name, domain, timezone, `google_classroom_enabled`, `is_active`, `demo_mode`, `is_trial`, `trial_started_at`, `trial_expires_at`, `trial_status`, `trial_plan`.
- **`school_licenses`** (`0007:15-36`): `tier` (essentials/professional/enterprise), `status` (trialing/active/past_due/suspended/cancelled), **`student_limit`** (seat cap, default 300), `trial_ends_at`, `renewal_date`, billing fields. One row per school (`UNIQUE school_id`). **License/seat authority.**
- **`users`** (`0001:40-60`): `role`, `school_id`, `full_name`, `email`, `parent_id`, `is_active`, `last_active_at`, `grade_level`. Count students/teachers/parents by `(school_id, role, is_active)`.
- **`classes`** (`0002:11`): `school_id`, **`teacher_id`** (single teacher-of-record FK), `name`, `subject`, `grade_level`, `period`, `google_course_id`, `enrollment_count`, `is_active`.
- **`enrollments`** (`0002`): `class_id`, `student_id`, `is_active`, `source` (`'google'`|null, `0024`). **Seat usage** = `COUNT(DISTINCT active student)` for the school vs `student_limit`. `enforce_enrollment_limit` trigger (`0026:56-77`) blocks over-cap enroll when license active/trialing.
- **Operational activity (school-scoped via class→school):** `quizzes` (published_at, status), `assignments` (status, due_at, created_at), `homework_attempts` (status, score_pct, submitted_at, graded_at). Countable per week.
- **Light health (operational framing):** `alerts` (`0017`: school_id, severity urgent/watch/info, status open/resolved), `high_fives` (`0017`: school_id, created_at). RLS has no authenticated-read policy → but the **admin client bypasses RLS**, so server-side school-scoped counts are fine (guard is the backstop). **Surface as COUNTS only — never per-student risk.**
- **`audit_logs`** (`0026`: school_id stamped, action, resource_type, metadata, created_at). RLS = platform-admin only, but admin-client server read is fine. (Optional school activity feed — defer unless wanted.)
- **PEDAGOGICAL / moat (DO NOT surface to school-admin):** `student_model_snapshots` (risk_score, divergence), `skill_learning_state` (CL), `misconception_observations`. RLS technically allows staff (incl. school_admin) to read, BUT per the four-audience/restraint discipline + the locked posture, **school-admin is operational, not diagnostic** — no per-student band/risk/CL.

## 3. V1 reference (the floor AND the cautionary tale)
- V1 school-admin is **sprawling**: `/admin` dashboard, `/admin/analytics`, `/admin/reports`, `/admin/teachers` (effectiveness), `/admin/alerts`, `/admin/spark`, `/admin/rosters`, `/admin/enrolment`, `/admin/billing`, `/admin/broadcast`, `/admin/audit`, `/admin/settings/sso`, `/admin/integrations` (SIS). Split: `school_admin` (pedagogical) vs `school_sysadmin` (operational).
- **V1's FATAL FLAW = stat-overload:** the admin dashboard makes 10+ parallel fetches and renders 50+ metrics (high-risk students, inactive teachers, concept gaps, 14-day score+risk sparklines, equity spread, LIFT intake, per-teacher/per-class/per-student tables). Analytics page = 3-4 screens of charts. **V2 must NOT copy this density.**
- V1 actions: roster CRUD (create user, add/remove from class, link parent), enrolment moves, alert resolve, broadcast, license activation, SIS config, audit view.
- **Scoping:** every V1 admin route uses `requireSchoolAdmin()` + `.eq('school_id', SCHOOL_ID)`.

## 4. LOCKED decisions (Marvin, 2026-06-26) + reconciliation
- **Scope = BROAD page set** (Marvin Q1): Overview · Teachers · Classes & Roster · Analytics · Reports (V1-style coverage), NOT just the operational trio.
- **Shell = real, mirror the teacher pop-art shell** (Marvin Q2): cobalt rail + sidebar nav + topbar.
- **Posture = operational + light-health counts** (Marvin Q3): **NEVER per-student band/risk/comprehension.**
- **RECONCILIATION → resolved by a ROLE SPLIT (Marvin, 2026-06-26):** the two customer-school admin roles differ.
  - **`school_sysadmin` (IT/ops):** **operational-only** — Overview, Teachers, Classes & Roster, Analytics (aggregate), Reports. NO per-student pedagogy.
  - **`school_admin` (academic head) + `platform_admin`:** all of the above PLUS a **Student-Attention pedagogical layer** — a **restrained grade/class rollup** ("this class has N students needing a look", band-level, NO raw risk numbers) that **drills into the EXISTING teacher student-profile / class views** (reuse, don't rebuild). Same restraint we hold for teachers.
  - Pedagogy is gated in the **nav AND URL-guarded** (a sysadmin hitting the pedagogy URL → operational view, never risk).
  - **Compliance:** four-audience = "not student/parent" — admins are staff (moat RLS already grants all staff read), so the academic head seeing student-attention data is NOT a violation. Hiding it from IT is **least-privilege/need-to-know**. The restrained band-level framing (no raw risk numbers) keeps it inside the same dignity bar as the teacher surface — NOT V1's raw-risk stat-overload.
- **Three tiers are distinct:** `platform_admin` (super-admin = INTELIFLOW, cross-tenant, the existing `(super-admin)` surface) ≠ `school_admin`/`school_sysadmin` (the CUSTOMER school's own staff, scoped to their one school, the `(school-admin)` surface we build).
- **NO migration** (admin-client reads, guard scopes). **Apply V2 restraint to PRESENTATION** (progressive disclosure, calm defaults, few numbers per section) even while covering V1's breadth.

## 5. Open scope notes (for the spec)
- DEFER (not pilot-critical, heavy): billing/Stripe (no Stripe wired in V2), SIS integrations, broadcast messaging, SSO settings, audit feed UI. Note them as future.
- Roster management: the school-admin can already run the **full roster importer** (`POST /api/admin/roster/import`, teacher-run too). The Classes & Roster page surfaces rosters + links to import; net-new write actions (add/remove student, create user) are a scope question for the spec.
