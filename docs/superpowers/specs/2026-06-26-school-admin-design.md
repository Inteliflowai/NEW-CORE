# School-Admin Pages — Design Spec

> Real school-admin surface for the customer school's own staff. Ground: `grounding/2026-06-26-school-admin/grounding-synthesis.md`. Decisions LOCKED (Marvin, 2026-06-26). Next: `writing-plans`.

## Goal
Replace the `(school-admin)` placeholder with a real, restrained, role-differentiated admin surface for the **customer school's own staff** — so a head of school / IT person who logs in gets a product, not a "coming soon" card. Scoped to their one school. **No migration** (admin-client reads, `guardSchoolAdmin` scopes).

## Non-goals
- NOT the platform super-admin surface (`platform_admin` = Inteliflow; `(super-admin)` already exists).
- NO billing/Stripe UI (no Stripe wired in V2), SIS integrations, broadcast messaging, SSO settings, audit-log UI — DEFER (note as future).
- NO V1-style stat-overload: restraint applies to PRESENTATION even where coverage is broad (few numbers per section, progressive disclosure).
- NO new diagnostic UI for the academic head — the pedagogy layer is a restrained rollup that **drills into the EXISTING teacher views**, not a new risk dashboard.
- NO migration; NO four-audience change (admins are staff; students/parents unaffected).

## Locked decisions (Marvin, 2026-06-26)
1. **Scope = broad page set** (not just an operational trio): Overview · Teachers · Classes & Roster · Analytics · Reports, plus the gated Student-Attention page.
2. **Real shell** mirroring the teacher pop-art shell (cobalt rail + sidebar + topbar).
3. **Posture = operational + light-health counts** by default; **no per-student band/risk/CL** on operational surfaces.
4. **Role split** (resolves the broad×no-risk tension):
   - **`school_sysadmin` (IT):** operational pages ONLY.
   - **`school_admin` (academic head) + `platform_admin`:** operational PLUS the Student-Attention pedagogy layer.
   - Gated in nav AND URL-guarded.
5. **Pedagogy depth = restrained rollup → drill into existing teacher views** (band-level, no raw risk numbers).

## Roles & capability gating
Three distinct tiers (see grounding §4). The `(school-admin)` surface serves `school_admin` + `school_sysadmin` (their own school) and is reachable by `platform_admin` (support).

New pure helper `src/lib/auth/adminCapabilities.ts`:
```ts
export type AdminRole = 'school_admin' | 'school_sysadmin' | 'platform_admin';
export interface AdminCapabilities { canSeeStudentAttention: boolean; }
export function adminCapabilities(role: string): AdminCapabilities {
  return { canSeeStudentAttention: role === 'school_admin' || role === 'platform_admin' };
}
```
- The nav (`AdminSidebar`) renders the Student-Attention link ONLY when `canSeeStudentAttention`.
- The Student-Attention page server component **re-checks** the capability (defense in depth): a `school_sysadmin` hitting the URL → `redirect('/admin/overview')` (never renders pedagogy). This is the URL-guard.

## Auth + scoping pattern (every page + loader)
Server component → `guardSchoolAdmin()` (`src/lib/auth/guards.ts:50`) → on error `redirect('/login')` → resolve `schoolId`:
- `school_admin`/`school_sysadmin` → `schoolId` from the guard (their own school).
- `platform_admin` → `schoolId` is null from the guard (unrestricted). For the first cut, resolve from `?school=<id>` if present, else show a lightweight "Pick a school" empty-state that links to `(super-admin)/schools`. (A full platform-admin school picker is DEFERRED — the primary audience is the customer's own staff.)
→ `createAdminSupabaseClient()` (RLS-bypassed; guard is the IDOR backstop) → pure `loadSchool*(admin, schoolId, …)` → presentational components. Loaders ALWAYS `.eq('school_id', schoolId)` (or class→school join); they NEVER trust a client-supplied schoolId for non-platform roles.

## File structure
- `src/app/(school-admin)/_components/{AdminShell,AdminSidebar,AdminTopbar}.tsx` (mirror `(teacher)/_components/*`) + `adminNavConfig.ts` (role-aware nav).
- `src/app/(school-admin)/layout.tsx` (modify) — switch from bare `RoleLayout` to `AdminShell`; keep `requireRole(SCHOOL_ADMIN_ROLES)`.
- Pages: `(school-admin)/admin/{overview,teachers,classes,analytics,reports,students}/page.tsx`. (Retire/redirect the old `admin/dashboard` placeholder → `/admin/overview`.)
- `src/lib/auth/adminCapabilities.ts` (pure).
- `src/lib/school/{loadSchoolOverview,loadSchoolTeachers,loadSchoolClasses,loadClassRoster,loadSchoolAnalytics,loadSchoolReport,loadStudentAttention}.ts` + `resolveAdminSchoolId.ts`.
- Reuse: `src/components/core/*` (Card/SectionLabel/GradeTrendSparkline/EmptyState), the existing teacher student/class views as drill targets, the roster importer (`/import`), the band→soft-label copy helpers (`src/lib/copy/*`, `src/lib/utils/masteryLabel.ts`).

## The pages

### Shell (both roles)
`AdminShell` = cobalt rail + `AdminSidebar` (logo plate, role-aware nav, user→/profile + sign-out) + `AdminTopbar` (page title via a TITLE_MAP, greeting client-only to avoid #418, avatar) + `main pop-canvas`. Reuse the teacher tokens (`bg-sidebar`, `border-sidebar-edge`, `sidebar-dots`, `sidebar-glow`, `shadow-sticker`). Nav sections: **School** (Overview, Teachers, Classes & Roster) · **Insight** (Analytics, Reports, [Student Attention — gated]).

### 1. Overview (`/admin/overview`, both roles)
Calm briefing, few numbers per card:
- **License & seats:** tier + status (trialing/active/…) + "142 of 300 seats used" + trial/renewal date (from `school_licenses` + `schools`). A gentle warn band near the cap.
- **At a glance:** active students · teachers · classes (counts from `users`/`classes`).
- **This week:** assignments submitted · quizzes published (operational counts via class→school) + light health: open alerts · high-fives sent (COUNTS only — never per-student).
- For `school_admin` only: a one-line "N students across M classes need a look this week" → links to Student Attention (hidden for sysadmin).

### 2. Teachers (`/admin/teachers`, both roles)
Operational coverage: each teacher → name, email, # classes, # students taught, last active. Expand → their class list (name, subject, grade, enrollment). NO risk/effectiveness/divergence.

### 3. Classes & Roster (`/admin/classes`, both roles)
Class list: name, subject, grade, teacher-of-record, active enrollment, Google-synced badge (`source='google'`). Click/expand → student roster (name, email, active, source). Link to the roster importer (`/import`). NO per-student diagnostics.

### 4. Analytics (`/admin/analytics`, both roles)
**Aggregate operational** only: school-wide activity over time (assignments/quizzes/completion per week — reuse `GradeTrendSparkline`/a token line), class comparison (completion rate, activity volume), adoption (teachers active this week, students active). NO per-student rows, NO risk.

### 5. Reports (`/admin/reports`, both roles)
Aggregate summaries (counts, completion, per-class rollups) + **CSV export** (roster, activity). Operational; no per-student signals.

### 6. Student Attention (`/admin/students`, school_admin + platform_admin ONLY)
The restrained pedagogy layer. Grade → class rollup: "Algebra I — 3 students to check" (band-level / "needs a look", NO raw risk numbers; reuse the teacher's soft-label copy). Each row **drills into the EXISTING teacher views** (`/students/[studentId]` and the class roster/gradebook) — do NOT rebuild a risk dashboard. `school_sysadmin` → `redirect('/admin/overview')`.

## Reuse vs net-new
- **Reuse:** teacher shell composition (copy the pattern, admin-themed), `core/*` kit, the existing teacher student/class drill targets, roster importer, band→soft-label helpers, the sparkline.
- **Net-new:** the `school/*` loaders, the admin shell components, `adminCapabilities`, the 6 pages.

## Restraint & compliance (binding)
- Token-only (no hardcoded hex/spacing/arbitrary `[…]`); deep-ink `text-fg`; WCAG-AA.
- Four-audience: operational surfaces show COUNTS, never per-student diagnostics; the pedagogy layer is staff-only (school_admin/platform_admin), band-level, drills into existing teacher views — students/parents are never involved.
- Restraint: ≤ a few numbers per card; progressive disclosure; quiet-when-empty (e.g., no "all clear" noise).
- "Assignments" not "Homework" in copy. New admin-visible strings → `STRINGS-FOR-BARB.md §School Admin`.

## Risks & mitigations
- **Pedagogy leaking to IT** → capability gate in nav + server-side URL re-guard (redirect) on the Student-Attention page; a `.test` asserts a `school_sysadmin` is redirected.
- **platform_admin null schoolId** → resolve via `?school=` or an empty-state pointer to `(super-admin)/schools`; loaders require a concrete schoolId (never query unscoped).
- **Stat-overload regression** → spec caps numbers-per-card; review lens checks restraint.
- **Cross-tenant IDOR** → loaders always scope by the guard's `schoolId`; non-platform roles can't override it (mirror `roster/import`).
- **Performance** → loaders use bounded aggregate queries (counts, windowed activity), not N+1 per-student sweeps.

## Test plan (TDD)
Pure: `adminCapabilities` (role→cap matrix). Loaders: each `loadSchool*` scopes by schoolId, returns the right shape, handles empty school. Capability gate: Student-Attention page redirects `school_sysadmin`; renders for `school_admin`. Nav: Student-Attention link hidden for sysadmin. Auth: each page redirects unauth/wrong-role. Restraint/leak: operational pages render no per-student risk/band; a `.leak`-style check on the operational loaders' output. Component tests for shell + each page (jsdom).

## Gates
tsc 0 · full vitest green · build 0 (a11y + tokens). NO migration. Strings → `STRINGS-FOR-BARB.md §School Admin`.
