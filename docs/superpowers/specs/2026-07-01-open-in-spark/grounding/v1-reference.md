# Grounding: V1 CORE teacher-facing SPARK surfaces + spark-platform teacher-role history

## 1. V1 CORE — teacher-facing views of SPARK student work

**There is NO teacher-facing "Open in SPARK" link and no teacher navigation into the SPARK app anywhere in V1.** Grep for `href`-to-SPARK / `sparkUrl` / `spark.inteliflowai` across `app/`, `components/`, `lib/` returns zero teacher-facing hits; the only SPARK URL builders are the student launch route and server-to-server webhooks. `C:/users/inteliflow/core/docs/changelog/2026-Q2.md:1445` records that `lib/integration/sparkUrl.ts` (`buildSparkDashboardUrl()`) had **zero callers** and was deleted.

What V1 teachers DO get is SPARK results rendered **inside CORE** (data copied over by the SPARK→CORE webhook `app/api/attempts/spark-attempt-complete/route.ts`, stored on `assignments.content.spark_rubric_dimensions` / `spark_ai_layer` / `spark_completed_at`):

- **`C:/users/inteliflow/core/components/spark/TeacherRubricViewer.tsx`** (entire file, 263 lines) — "Teacher-facing rubric viewer for a SPARK simulation completion" (header comment lines 4–27). Renders the 7-dimension 1–4 rubric (Problem Understanding, Reasoning & Strategy, Use of Evidence, Creativity, Communication, Reflection, Collaboration; lines 65–75) with proficiency labels Emerging→Advanced (77–82) plus five LearnerProfile narrative sections: `teacher_takeaway` (191–208), `short_narrative.teacher` "Quick read" (210–218), `strongest_signals.teacher` (220–228), `growth_areas.teacher` (230–238), `teacher_prompt` "Try this next" (240–258).
- **Mounted in the gradebook cell drill-in**: `components/teacher/gradebook/CellDrillIn.tsx:36` (import) and `:322-334` — renders only when `detail.assignment.assignment_mode === 'spark_experiment' && detail.assignment.content?.spark_rubric_dimensions` (326–327). CellDrillIn itself is mounted at `app/(dashboard)/teacher/gradebook/page.tsx:399`. This is the ONLY usage of `TeacherRubricViewer` (plus its test).
- **Teacher student drill-in** `app/(dashboard)/teacher/students/[id]/page.tsx`:
  - `StudentTrajectoryTab` at `:2180` → `components/teacher/StudentTrajectoryTab.tsx:211` renders `<SparkPanel data={data.spark_profile_arc} …/>`; panel 3 "On Spark — one prose read" (439–494) shows latest-profile strongest/growth teacher strings + expandable per-attempt `SparkEntryCard`s (497–541) with quick-read/strongest/growth per SPARK completion. States: `no_spark_history` → hidden, `spark_history_no_profiles` → count-only line (453–459).
  - `WholeStudentSummary` at `:1157` → `lib/teacher/wholeStudentSummary.ts:59-61` + `:422-440` folds last-7d completed `assignment_mode='spark_experiment'` rows (title + strong/growth dimensions via `extractRubricDimensions`) into the AI whole-child summary; prompt rule at `:481-482`: reference SPARK dimensions "by their natural meaning, never by category name".
  - Printable per-student report (page.tsx:799 "report covering Learner Profile + quiz + homework + SPARK") → `lib/teacher/perStudentReportData.ts:403-420` builds a SPARK rubric-dimensions section from `student_model.spark_dim_*` rolling averages.
- **Admin (not teacher-role) SPARK surfaces**, for completeness: `app/(dashboard)/admin/spark/page.tsx` (school-admin per-student SPARK dashboard; header comment lines 6–12: 7 dim-average bars, profile ✓/✗, "Click → /teacher/students/[id] (full SPARK rubric viewer there)"), backed by `app/api/teacher/admin/spark-activity/route.ts:50` gated `['school_admin','school_sysadmin','platform_admin']` (comment line 12–14: "Teachers … need the school-wide pulse" — plain teachers are NOT allowed) and `app/api/teacher/admin/spark-students/route.ts`; platform-admin-only `app/(dashboard)/platform/spark-status/page.tsx` + `app/api/teacher/platform/spark-monitor/route.ts:55` (`profile?.role !== 'platform_admin' → 403`). Nav entries at `app/(dashboard)/layout.tsx:138` (`/admin/spark`) and `:189` (`/platform/spark-status`).

So: V1's model is **embedded results, never a review page inside SPARK** — the teacher never sees the student's actual step-by-step SPARK work/artifact, only the rubric numbers + AI narrative shipped over the webhook.

## 2. spark-platform git history — teacher removal

**Correction to the received claim ("teacher role removed in migration 027"): migration 027 retired the `school_admin` role, NOT teacher. The `teacher` role still exists in the SPARK schema today.** The teacher **UI** was removed in commit `f881f39` (2026-05-01).

### Commit `f881f39` — `feat(spark): retire legacy teacher UI (April 29 pivot close-out)`

> "The April 29 strategic pivot established that SPARK is no longer a standalone product — teachers interact with CORE; CORE delegates to SPARK invisibly via the bridge webhook."

**14 pages deleted:** `app/(dashboard)/teacher/{page,students-manage,launch,library,build,generate,generate/review/[draftId],signals,hardware,sessions/[sessionId],students/[studentId]/spark}/page.tsx`, `app/(dashboard)/experiments/{page,[id]/page}.tsx`, `app/(dashboard)/admin/experiments/page.tsx`.
**15 API routes deleted:** `app/api/teacher/students/route.ts`, `app/api/teacher/students/[studentId]/growth-chips/route.ts`, `app/api/teacher/signals/summary/route.ts`, and 12 `app/api/experiments/*` routes (catalog, generate, drafts, marketplace, search, sessions, media, video).
**308 permanent redirects** were added in `next.config.ts` pointing every retired URL at `https://app.inteliflowai.com/teacher` (CORE's teacher landing).

**The role-check pattern the removed teacher API routes used** (from deleted `app/api/teacher/students/route.ts`):

```ts
const admin = createAdminSupabaseClient();
const { data: me } = await admin.from("spark_users").select("id, role, school_id").eq("auth_id", user.id).single();
if (!me?.school_id || !["teacher", "school_admin", "school_sysadmin", "platform_admin"].includes(me.role)) {
  return NextResponse.json({ error: "Teacher access required" }, { status: 403 });
}
```

**Removed teacher nav** (diff of `app/(dashboard)/layout.tsx`):

```diff
   teacher: [
-    { label: "Dashboard", href: "/teacher", icon: "layout" },
-    { label: "My Students", href: "/teacher/students-manage", icon: "building" },
-    { label: "Launch", href: "/teacher/launch", icon: "rocket" },
-    { label: "My Library", href: "/teacher/library", icon: "book" },
-    { label: "Challenges", href: "/experiments", icon: "flask" },
-    { label: "AI Generator", href: "/teacher/generate", icon: "bot" },
-    { label: "Signals", href: "/teacher/signals", icon: "activity" },
-    { label: "Hardware", href: "/teacher/hardware", icon: "cpu" },
     { label: "Support", href: "/support", icon: "help" },
   ],
```

**What the closest thing to an "attempt review" looked like before removal** — deleted `app/(dashboard)/teacher/students/[studentId]/spark/page.tsx` ("StudentDeepDivePage"): three LIVE growth-signal chips fetched from `/api/teacher/students/${studentId}/growth-chips` (self-unblock rate, hypothesis-revision rate, mastery-shortcut rate), but the per-attempt list, ISM/ITC profiles, and domain strengths were **hardcoded mock/fixture data** ("Mock student data — in production, fetched from API"; `DemoDataBanner note="Student bio + scores are fixture data…"`). Deleted `app/(dashboard)/teacher/sessions/[sessionId]/page.tsx` (live session monitor) was likewise fully simulated ("Simulated data — in production, polls /api/experiments/sessions/[id]/status"). Deleted `app/api/teacher/signals/summary/route.ts` WAS a real live aggregate endpoint (experiment_attempts + spark_ai_analysis, school-scoped, teacher/school_admin/school_sysadmin; platform_admin all schools). **SPARK never had a working teacher page that showed one student's actual attempt content** — the deleted UI showed signals/aggregates, with the per-attempt rows mocked.

### Migration 027 + commit `5759d71` — what was actually role-retired

`supabase/migrations/027_retire_school_admin_role.sql` retired `school_admin` only, and the resulting CHECK constraint **keeps `teacher` as a valid role**:

```sql
ALTER TABLE spark_users DROP CONSTRAINT IF EXISTS spark_users_role_check;
ALTER TABLE spark_users ADD CONSTRAINT spark_users_role_check
  CHECK (role IN ('student', 'teacher', 'school_sysadmin', 'platform_admin'));
```

RLS after 027 also still grants `teacher` read on gamification/XP tables:

```sql
CREATE POLICY "gamification_read" ON spark_gamification FOR SELECT
  USING (student_id IN (SELECT id FROM spark_users WHERE auth_id = auth.uid()) OR get_my_spark_role() IN ('teacher','school_sysadmin','platform_admin'));
```

Commit `5759d71` message confirms the division: "The legacy teacher UI was retired in previous commits. This commit retires the school admin role… The platform_admin role remains… The school_sysadmin role… also stays." Reversibility note in 027: "re-run migration 005 + 006 + 016 USING/CHECK clauses to restore the role."

**Current spark-platform pages** (post-cleanup): only `app/(dashboard)/student/{page, experiment/[sessionId], lab, lab/artifact/[attemptId]}`, `admin/*` ops surfaces, `dashboard`, `support`, public/demo/login pages. No `teacher/` directory exists.

## 3. Direct teacher SSO/handoff between V1 CORE and SPARK

**None ever existed. The only CORE→SPARK SSO handoff is student-only:**

- V1 `app/api/attempts/spark-launch/route.ts` — mints an HS256 JWT signed with `CORE_SPARK_API_SECRET`, claims `{ core_user_id, core_school_id, spark_attempt_id, email, full_name, grade, return_url }` (lines 88–96, 15-min expiry). **No role claim exists in the JWT.** It hard-gates ownership: `if (assignment.student_id !== userId) return { ok:false, status:403, error:'Not your assignment' }` (line 36). Launch URL (line 109–110): `${SPARK_API_URL}/api/integration/auth?token=…&redirect=/student/experiment/{sparkAttemptId}`. Consumed by the student-facing `components/homework/SparkAssignmentCard.tsx:147-166` ("Launch in Spark →", line 349).
- SPARK `app/api/integration/auth/route.ts` — verifies the JWT (`verifyCoreJWT` in `lib/integration/core-client.ts:171-246`; payload interface has `core_user_id`, `core_school_id`, `spark_attempt_id`, `return_url` — no role field) and **upserts the user with a hardcoded role**: `role: "student"` (line 150). The `redirect` param is sanitized to a same-origin path defaulting to `/student` (lines 26–27).
- `git log -S 'role: "teacher"'` / `-S "role: 'teacher'"` over the auth route's full history (`0393979` → `3cb1958`) shows no teacher-role variant of the handoff ever existed; the hits are unrelated (webhook `teacher_id` resolution, GHL CRM sync, user management).
- In the standalone-SPARK era, teachers logged into SPARK **directly** via SPARK's own Supabase auth (`app/login/page.tsx`; the deleted teacher pages used `createBrowserSupabaseClient` sessions) — separate accounts, not SSO from CORE.
- V1's `app/api/admin/sign-spark-test-jwt/route.ts` is an ops/test surface (provisioning-secret gated) that mints JWTs for the **SPARK→CORE webhook receiver** (`spark-attempt-complete`), not a user handoff.

**Key file paths:**
- `C:/users/inteliflow/core/components/spark/TeacherRubricViewer.tsx`
- `C:/users/inteliflow/core/components/teacher/gradebook/CellDrillIn.tsx` (:322-334)
- `C:/users/inteliflow/core/components/teacher/StudentTrajectoryTab.tsx` (:211, :439-541)
- `C:/users/inteliflow/core/lib/teacher/wholeStudentSummary.ts` (:422-440)
- `C:/users/inteliflow/core/lib/teacher/perStudentReportData.ts` (:403-420)
- `C:/users/inteliflow/core/app/api/attempts/spark-launch/route.ts` (:36, :88-110)
- `C:/users/inteliflow/spark-platform/app/api/integration/auth/route.ts` (:150)
- `C:/users/inteliflow/spark-platform/lib/integration/core-client.ts` (:171-246)
- `C:/users/inteliflow/spark-platform/supabase/migrations/027_retire_school_admin_role.sql`
- spark-platform commits: `f881f39` (teacher UI retired), `5759d71` (school_admin role retired, migration 027)