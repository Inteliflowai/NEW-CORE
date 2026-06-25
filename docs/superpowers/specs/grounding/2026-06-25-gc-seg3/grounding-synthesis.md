# GC Segment 3 Grounding Synthesis (publish + draft grade passback)

> Gathered 2026-06-25 by 5 parallel readers (V2 GC foundation + V1 reference) + opus synthesis. file:line-cited.

The scopes verdict is confirmed: `classroom.coursework.students` and `classroom.courseworkmaterials` are already in `GC_SCOPES` (requested at connect) AND `GC_REQUIRED_SCOPES`. No re-consent needed. Here is the synthesized map.

---

# GC Segment 3 — Grounding & Decision Map
**Publish CORE units → Google Classroom stream + teacher-controlled DRAFT grade passback + Open-CORE link**

## 1. What exists today (V2 foundation)

**GC lib layer** (`src/lib/google/`, 10 modules + error types) — the spine Seg 3 plugs into:
- **HTTP client** `classroom.ts` — `BASE = 'https://classroom.googleapis.com/v1'`, zero-dep raw `fetch`, `gcGet()` sends `Authorization: Bearer {token}`, 403-scope pattern → `GoogleScopeError`, non-200 → status-only error (no body leak), paginates `nextPageToken` @ pageSize 100. Currently only GET helpers (`listCourses`, `listCourseStudents`); **Seg 3 adds POST/PATCH writers in the same file/pattern.**
- **Token fetch** `tokens.ts:62-96` — `getValidAccessTokenForTeacher(admin, teacherId): Promise<string>` reads encrypted `google_connections` row, lazy-refreshes within 60s of expiry, persists new token, throws `GoogleNotConnectedError` if missing/refresh-fails. **This is the call every Seg 3 writer makes.**
- **Identity map** `resolveExternalIdentity.ts:15-45` — WRITE-FREE. Given `(schoolId, provider:'google', externalId: googleUserId)` returns CORE `student_id` (or unambiguous-email fallback). **This is the inverse lookup grade passback needs: GC submission's student userId → CORE student.** Seg 2 already writes `external_identities` rows (`linkOrCreateStudent.ts:17-30`, provider `'google'`, `external_id = googleUserId`).
- **Reconnect signalling** `errorEnvelope.ts:9-14` — `gcErrorResponse(err)` maps `GoogleNotConnectedError → {connected:false}`, `GoogleScopeError → {connected:true, needsReconnect:true}`, else 500. Reuse verbatim on Seg 3 routes.

**Connection + scopes** `google_connections` (migration 0022) — per-teacher AES-256-GCM token vault, `granted_scopes text[]`, RLS deny-by-default, admin-client only. `scope-check/route.ts` diffs live tokeninfo vs `GC_REQUIRED_SCOPES` with a `granted_scopes` DB fallback.

**Class ↔ course mapping** `classes` (migration `0002_classes_enrollments.sql:19-21`): `google_course_id text`, `google_grade_sync_enabled boolean DEFAULT false`, `google_feed_enabled boolean DEFAULT false` — **these flag columns already exist, unused; Seg 3 is their first consumer.** Migration 0024 adds `UNIQUE(school_id, google_course_id)`.

**Publishable entities + their grades:**
- **Quizzes** — class-level publishable unit. `quizzes/manage/route.ts:73-76` sets `status='published' + published_at=now()` (the student-visibility gate). Score in `quiz_attempts.score_pct` (0–100 numeric, `0003:62`).
- **Assignments** — per-student rows, `status` only, **no `published_at`, no class-wide publish concept** (`0004_assignments_homework.sql`). Final grade = `teacher_score ?? score_pct` (override-wins, `loadGradebook.ts:179-180`), 0–100 numeric.

**Auth chain + audit (both now available):**
- `guardClassAccess(classId): Promise<NextResponse|null>` (`guards.ts:68-78`) — teacher-owner / same-school-admin / platform-admin; 403-not-404. Pattern: `getUser → STAFF_ROLES → guardClassAccess → admin client` (`google/sync/route.ts:15-49`).
- `logAudit(admin, {actorId, schoolId, action, resourceType, resourceId, metadata})` (`logAudit.ts`) — `actorId:null` = system/cron. `audit_logs` (migration 0026) deny-by-default RLS, no FKs (survives deletion), `school_id` always stamped.
- **Next migration number = 0027.**

## 2. The SCOPES verdict — **NO re-consent required** (gating fact, confirmed)

`src/lib/google/config.ts:17-18` — both write scopes were requested at the Seg-1 connect:
```
classroom.coursework.students    (write courseWork + student-submission grades)
classroom.courseworkmaterials    (write the Open-CORE material)
```
…and both are in `GC_REQUIRED_SCOPES:28-29`, so every teacher who completed Seg-1 connect (the one live teacher, and all future ones) **already holds the scopes Seg 3 needs to create courseWork and PATCH draft grades.** Seg 3 adds no scope.

**Reconnect path (already built, just wire it):** Seg 3 writers call `getValidAccessTokenForTeacher` and wrap in `try/catch → gcErrorResponse`. If Google ever returns a 403 scope error, that becomes `{needsReconnect:true}` and the UI sends the teacher to `/settings/google` to reconnect (re-consent re-grants and `storeConnection` overwrites `granted_scopes`, `tokens.ts:45-52`). This is the standard fallback, not an expected step.

## 3. V1 reference (how V1 did it — the proven shape to port)

- **CourseWork CREATE** (`core/lib/integrations/lms/google-classroom.ts:158-169`): `POST /courses/{courseId}/courseWork`, body `workType:'ASSIGNMENT'`, **`state:'PUBLISHED'`** (immediately live, not draft), `materials:[{link:{url: launchUrl}}]`, `maxPoints` (teacher-supplied or null/100), optional `dueDate/dueTime`.
- **Open-CORE link** (`courseLink.ts:184-210`): a separate **`courseWorkMaterials`** (not courseWork) — `POST /courses/{courseId}/courseWorkMaterials`, `state:'PUBLISHED'`, `materials:[{link:{url:'/launch/home?src=google_classroom'}}]`. Idempotent per course via `lms_publications` lookup + UNIQUE; `grade_passback_enabled=false`.
- **Grade passback** (`google-classroom.ts:212-243`, `gradePassback.ts`): `PATCH /courses/{c}/courseWork/{cw}/studentSubmissions/{sub}?updateMask=assignedGrade,draftGrade` with body `{assignedGrade:score, draftGrade:score}` — **V1 set BOTH and did NOT call `:return`.** Score map (`gradePassback.ts:69-73`): clamp 0–100 → `(score/100)*maxPoints`, maxPoints default 100. **FAIL-SOFT**: fire-and-forget `after()`, retries `[1s,3s]`, logs `last_sync_error`, never blocks grading. **GATED** on `grade_passback_enabled=true` + published + student external identity exists + class course matches (`gradePassback.ts:131-164`). SPARK never pushed.
- **Mapping table** `lms_publications` (`core/supabase/migrations/074_lms_connector.sql:29-50`): `UNIQUE(provider, resource_type, resource_id, course_external_id)`; columns `external_assignment_id`, `resource_type (quiz|homework|spark|course_link)`, `resource_id`, `grade_passback_enabled`, `max_points`, `launch_url`. → **the model for V2's `google_publications`.**

> ⚠️ V1 divergence to decide: V1 published `state:'PUBLISHED'` and set `assignedGrade` (auto-visible to students). Marvin's Seg-3 brief says **DRAFT + no `:return`** — i.e. softer than V1. Decisions below resolve this.

## 4. What does NOT exist (the gaps Seg 3 fills)

1. **No `google_publications` table** (or any courseWork/passback reference) anywhere in V2 src or migrations — net-new (migration **0027**).
2. **No courseWork/courseWorkMaterials/studentSubmissions writers** in `classroom.ts` — only GET helpers exist.
3. **No "Publish to Google Classroom" or "Send grades to Classroom" UI** — quiz manage only flips `status/published_at`; gradebook drill-in only does override/notes.
4. **No grade-passback engine** (V1's `gradePassback.ts` not ported) — no score→points scaling, no fail-soft `after()` retry, no gated push.
5. **No Open-CORE link writer** — and **no silent-SSO launch** (that's Seg 4); a pinned link today lands on a login wall.
6. **`google_grade_sync_enabled` flag is unread** — no code toggles or honors it yet.

## 5. Design decisions Marvin must make

**D1 — Reconnect (scopes).**
Plain English: *When a teacher first sends work or grades to Google Classroom, will it just work, or will some teachers have to reconnect their Google account first?*
- Grounded fact: every teacher who already connected holds the write scopes (§2) — **it just works.** Reconnect is only a rare-error fallback.
- **Recommend:** Ship Seg 3 with no scope change; if Google ever returns a scope error, surface the existing "Reconnect Google" prompt (reuse `gcErrorResponse → needsReconnect`). *Rationale: zero added friction for the pilot; the safety net already exists.*

**D2 — What to publish.**
Plain English: *Should the button push quizzes, assignments, or both into Google Classroom — and should each appear as a Classroom assignment that links back into CORE, or as a native Google quiz?*
- Options: (a) quizzes only; (b) assignments only; (c) both; (d) link-back courseWork vs native GC quiz.
- **Recommend:** **Both quizzes and assignments, each as a GC `courseWork` (workType ASSIGNMENT) whose material is a link back to CORE** (V1's proven model, `google-classroom.ts:158-169`). Not native GC quizzes. *Rationale: CORE owns the experience (Teli, behavioral signals, drawing/voice) — GC is the front door, not the runner; native GC quizzes would bypass the whole moat.*

**D3 — Publish state (DRAFT vs PUBLISHED).**
Plain English: *When CORE creates the item in Google Classroom, should it appear immediately to students, or land as a draft the teacher reviews and posts inside Classroom?*
- Options: (a) `state:'DRAFT'` — teacher reviews/posts in GC; (b) `state:'PUBLISHED'` — live immediately (V1's choice).
- **Recommend:** **DRAFT** (overrides V1). *Rationale: matches the brief's teacher-controlled posture and the whole "teacher confirms" theme of GC seg work; the teacher hits Post in Classroom when ready — no surprise assignments appear for students.*

**D4 — Grade passback model.**
Plain English: *When grades go to Google Classroom, should they post as a draft grade the teacher must release in Classroom (never auto-returned to students), and which CORE grade should we send?*
- Grounded: V1 set both `assignedGrade`+`draftGrade` (auto-visible). Brief says **draftGrade only, no `:return`.** CORE grade = `teacher_score ?? score_pct` (`loadGradebook.ts:179-180`). Scale: `(score/100)*maxPoints`, maxPoints default 100 (V1 `gradePassback.ts:69-73`).
- **Recommend:** PATCH `updateMask=draftGrade` only (omit `assignedGrade`, no `:return`); send `teacher_score ?? score_pct`; maxPoints default 100, teacher-overridable at publish; **fail-soft via `after()` with `[1s,3s]` retry, gated on `grade_sync_enabled` + published + resolvable external identity** (port V1's gating). Per-student push on grade finalize **plus** a batch "Send grades" action. *Rationale: draftGrade keeps the teacher as the only one who releases a grade to a student — the four-audience/coach posture — while reusing V1's battle-tested fail-soft engine.*

**D5 — Open-CORE link: now or defer.**
Plain English: *Should we pin an "Open CORE" link in the Classroom course now, even though clicking it lands on a login screen until Segment 4 builds the one-click sign-in?*
- Grounded: Seg 4 (silent SSO) not built; a link today = plain link → login wall.
- **Recommend:** **Pin the Open-CORE `courseWorkMaterials` link now** (idempotent per course, port `courseLink.ts`), pointing at a stable CORE URL that requires normal login until Seg 4 upgrades it to silent launch. *Rationale: the pin is cheap and idempotent; teachers see the integration is live; Seg 4 only swaps the URL behavior, not the pin. (If Marvin prefers no login-wall friction in the pilot, defer the pin to Seg 4 — one-line call.)*

**D6 — Trigger surface (where the teacher clicks).**
Plain English: *Where do teachers click "Publish to Classroom" and "Send grades to Classroom"?*
- Options: publish on the quiz Library row / assignment; grades in gradebook drill-in (per student) vs a gradebook batch button.
- **Recommend:** **Publish** = action on the quiz Library row (`QuizLibrary`) and the assignment, shown only when the class has `google_course_id`. **Send grades** = a **batch action above the gradebook grid** (push all graded cells for that courseWork) **plus** an auto-push in the existing grade-finalize `after()` path. *Rationale: publish belongs where the content lives; grades belong in the gradebook; batch matches how teachers think ("send this assignment's grades").*

**D7 — Audit.**
Plain English: *Should every publish and every grade send be written to the audit log?*
- **Recommend:** **Yes** — `logAudit` on publish (`action:'gc.publish'`) and each passback (`action:'gc.grade_passback'`), `actorId` = teacher (or `null` for any cron/`after()` system push), `schoolId` stamped. *Rationale: grade writes to an external system are exactly the sensitive, disputable actions the 0026 audit table exists for.*

## 6. Risks / constraints

- **Re-consent friction:** near-zero (§2) — but keep the `needsReconnect` fallback wired so a scope error never hard-fails a publish.
- **Scope minimization:** no new scopes; do not add `coursework.me` or broader — the two write scopes already cover create + draft-grade.
- **GC API quotas / transient errors:** raw fetch surfaces non-200 as status-only errors; passback **must be fail-soft** (`after()` + `[1s,3s]` retry + `last_sync_error` on the publication row) — a Google outage must never block CORE grading/submission.
- **Teacher-controlled, never auto-return:** `draftGrade` only, no `:return` — this is a binding posture line, not a default to revisit; a student must never see a CORE-pushed grade until the teacher releases it in Classroom.
- **Audit every passback** (D7) — grade writes to a system of record are disputable.
- **RLS:** `google_publications` follows the house pattern — deny-by-default, admin-client-only access behind the route auth chain (mirror 0022/0023/0026); RLS is not the IDOR backstop, `guardClassAccess` is.
- **Open question (resolve in plan):** identity resolution at passback depends on `resolveExternalIdentity` returning a student — students without a Google external_identity (file-roster `source` ≠ google) **will silently skip passback**; surface a per-student "not linked to Classroom" reason rather than failing the batch.
- **V1 = reference only:** port the *shape* (`google-classroom.ts`/`gradePassback.ts`/`courseLink.ts`/`074_lms_connector.sql`), not the code — V2 differs on DRAFT state (D3) and draftGrade-only (D4).
- **Pilot-friendliness:** single live teacher; keep the surface small (publish + send-grades + pin), fail-soft everywhere, and gate all of it behind `google_course_id` being set so non-GC classes never see GC controls.

**Key files of record** — port-from (V1): `core/lib/integrations/lms/{gradePassback,google-classroom,courseLink}.ts`, `core/supabase/migrations/074_lms_connector.sql`. Build-on (V2): `src/lib/google/{classroom,tokens,resolveExternalIdentity,errorEnvelope}.ts`, `src/lib/auth/guards.ts`, `src/lib/audit/logAudit.ts`, `src/app/api/teacher/quizzes/manage/route.ts`, `src/lib/gradebook/loadGradebook.ts`, `src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx`, migrations `0002`/`0003`/`0004`/`0022`/`0024`/`0026`. New: migration **0027** `google_publications`.