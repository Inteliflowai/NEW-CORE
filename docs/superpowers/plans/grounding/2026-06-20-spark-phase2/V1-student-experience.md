# V1 Student SPARK Experience + Assignment/Attempt Model — Verbatim Grounding

READ-ONLY grounding for CORE V2 Phase 2 (SP-B student app, greenfield in V2).
Source repo: V1 CORE at `C:/users/inteliflow/core` (Next.js App Router, top-level
`app/` — NO `src/`). All quotes verbatim with `file:line`.

---

## 0. Headline architecture (what a V2 port must mirror)

V1's student assignment surface is **`/student/homework`** — a single client page
(`app/(dashboard)/student/homework/page.tsx`, **1557 lines**). It is BOTH:

1. **A full in-app assignment PLAYER** for regular (CORE-graded) homework — a
   two-phase ("read" → "tasks") carousel with per-task tutor chat (Teli), hints,
   image upload, a full drawing canvas, TTS audio, diagram/video generation,
   localStorage + server draft autosave, and a graded-submit flow.
2. **A parallel SPARK launch card** (`SparkAssignmentCard`) rendered ALONGSIDE the
   tasks. SPARK is **enrichment that lives next to the homework, not a task type
   and not a subset of the tasks**. The card has NO in-app player — it opens SPARK
   in a new tab via JWT handoff and then polls for completion.

So the answer to the scope question: **V1 builds a full in-app player for non-SPARK
assignments AND a launch-only card for SPARK.** They coexist on the same page. SPARK
is never played inside CORE.

There is NO `spark_status` column anywhere (grep returned zero). SPARK state lives
in two assignment columns (`spark_attempt_id`, `spark_experiment_id`), a boolean
(`spark_sync_failed`), and inside the `assignments.content` JSON blob
(`spark_completed_at`, `spark_score`, `spark_effort_label`, `spark_rubric_dimensions`,
`spark_ai_layer`, `spark_content_quality`). `assignment_mode` is a separate enum.

---

## 1. Student routes (Glob `app/(dashboard)/student/`)

```
challenges/[id]/page.tsx     # teacher-approved EXTENSION challenge (NOT SPARK; in-app text submit)
chapter-test/[chapterTestId]
homework/page.tsx            # THE assignment player + SPARK launch card (1557 lines)
homework/actions.ts          # server actions: sendTutorMessage, submitHomework
hugs/  me/  page.tsx  progress/  quiz/  redacao/  tasks/
```

`student/page.tsx` is the dashboard. The assignment list+detail+player all live
under `student/homework`. `challenges/[id]` is a DIFFERENT feature (extension
"I-Got-This" challenge with an in-app textarea + AI assessment polling — see §6),
NOT the SPARK launch path.

---

## 2. How the student sees assignments (list → detail → launch)

### List view
`student/homework` with **no `assignmentId` searchParam** shows a list. The page
fetches `/api/attempts/homework-list` and renders `HomeworkListView`.

`page.tsx:239-247`:
```ts
const param = searchParams.get('assignmentId');
// No specific assignment requested — show the list
if (!param) {
  await loadHomeworkList();
  setShowList(true);
  setLoading(false);
  return;
}
```

`HomeworkListView` (`components/student/homework/HomeworkListView.tsx`) renders TWO
sections from the SAME assignment rows — a "⚡ SPARK Challenges" section (one
`SparkAssignmentCard` per row whose `spark_attempt_id` is set) followed by a "📋
Homework" list of clickable rows. **The same assignment can appear in BOTH** — they
are parallel surfaces, not alternatives:

`HomeworkListView.tsx:62-97` (verbatim comment + gate):
```tsx
{/* SPARK Challenges section — parallel-SPARK architecture (Barb 2026-05-04).
    Render an entry for each assignment with spark_attempt_id populated. The SAME
    assignment also appears below in the standard homework list ... Legacy
    assignment_mode='spark_experiment' rows (pre-pivot) still match ... */}
{filtered.some((hw) => !!hw.spark_attempt_id) && ( ... <SparkAssignmentCard .../> ... )}
```
Standard list filters OUT only legacy spark-only rows:
`HomeworkListView.tsx:101`:
```tsx
{filtered.filter((hw) => hw.assignment_mode !== 'spark_experiment').map(hw => { ... })}
```
Standard-row status pills: `📝 Start` (pending) / `⏳ Submitted` / `✅ <gradedPill>`
(`HomeworkListView.tsx:102-124`). Clicking a row calls `onSelectHomework(assignment_id)`
→ `loadSpecificAssignment` → re-fetches detail.

### Detail / player view
With `?assignmentId=...` the page loads the full assignment via
`/api/attempts/student-homework` (`page.tsx:249-256`, `setupAssignment`). Header
shows title, RETEACH / scaffold pills, a "read ● — ● tasks" phase indicator, and an
`N/M tasks` progress bar (`page.tsx:893-933`). The task carousel + Teli tutor chat +
canvas is the in-app player (rest of the 1557-line file).

---

## 3. How spark_status drives the UI — launch card vs in-app player

### Render gate (homework page, in-detail)
The SPARK card renders ABOVE the reading passage, visible in both phases, gated on
`spark_attempt_id` populated AND `spark_sync_failed !== true`:

`page.tsx:937-971` (verbatim comment + gate):
```tsx
/* PARALLEL SPARK CHALLENGE — visible in both phases
   May 2026 / Barb directive: SPARK Challenge is a SEPARATE, ENRICHMENT
   assessment that lives ALONGSIDE homework, not inside the homework task
   carousel. Total student work = N homework tasks + 1 Spark Challenge. The
   Challenge is rubric-evaluated (7 dimensions, 1-4 scale) and lives outside
   the gradebook ...
   Render gate: `assignment.spark_attempt_id` populated AND `spark_sync_failed
   !== true`. The notify webhook returns spark_attempt_id even on generation
   failure (audit trail), but the gate excludes failed-gen rows ... */
{assignment.spark_attempt_id && assignment.spark_sync_failed !== true && (
  ...
  <SparkAssignmentCard
    assignmentId={assignment.id}
    title={assignment.content.title}
    dueDate={null}
    status="assigned"
    score={null}
    effortLabel={null}
    sparkExperimentId={assignment.spark_experiment_id ?? null}
    onStatusChange={setSparkStatus}
  />
)}
```

### Submit gate — SPARK completion blocks HW submit
`page.tsx:840-851` (verbatim):
```ts
// When SPARK is part of the assignment, BOTH HW and SPARK must be complete
// before submit. Server-side gate in /api/attempts/homework-submit enforces
// this regardless; this UI gate is the user-friendly version ...
const sparkRequired = !!assignment.spark_attempt_id && assignment.spark_sync_failed !== true;
const sparkComplete = sparkStatus === 'completed';
const sparkBlocking = sparkRequired && !sparkComplete;
const canSubmit = allTasksDone && !sparkBlocking;
```
`sparkStatus` is lifted up from `SparkAssignmentCard` via `onStatusChange` (declared
`page.tsx:79`).

### The card itself (`components/homework/SparkAssignmentCard.tsx`)
- States: `'assigned' | 'in_progress' | 'completed' | 'late'` (STATUS_CONFIG
  `:50-55` → labels Not Started / In Progress / Completed / Late).
- **There is NO in-app attempt player in the card.** It has a **Launch button only**
  (`:340-355`):
  ```tsx
  {status !== 'completed' && (
    <button onClick={handleLaunch} disabled={launching} ...>
      {launching ? 'Opening Spark...' : 'Launch in Spark →'}
    </button>
  )}
  ```
- `handleLaunch` (`:147-169`): POST `/api/attempts/spark-launch` with
  `{ assignment_id }`, set status `in_progress`, then `window.open(launch_url, '_blank')`.
- Header badges: `⚡ SPARK CHALLENGE` pill, a `✓ Teacher-approved` pill
  (`:221-232`, "Your teacher selected or approved this challenge for you."), an
  `InfoTooltip` describing SPARK's S→P→A→R→K stages and "doesn't count for your
  grade ... It's enrichment" (`:233-237`).
- Completed state branches on `contentQuality` (`:273-323`): `non_engaged` → "📚
  Take another shot" (suppresses the misleading 25% floor); `minimal` → "try going
  deeper"; else → green `score%` + `EFFORT_LABELS` summary. When
  `rubricDimensions` present, renders `<StudentRubricViewer>` (`:328-337`).

### Polling cadence (60s) + window-focus refresh
`SparkAssignmentCard.tsx:105-145`:
```ts
const checkStatus = useCallback(async () => {
  const res = await fetch(`/api/attempts/spark-status?assignment_id=${assignmentId}`);
  ... if (data.status === 'completed') { setStatus('completed'); setScore(data.score);
       setEffortLabel(data.effort_label); setCompletedAt(...); setRubricDimensions(...);
       setAILayer(...); setContentQuality(...); }
}, [assignmentId]);

useEffect(() => {
  // Poll while: assigned | in_progress | completed-but-rubric-not-hydrated
  if (status !== 'in_progress' && status !== 'assigned' && !needsRubricHydration) return;
  const interval = setInterval(checkStatus, 60000);   // 60s
  return () => clearInterval(interval);
}, [status, needsRubricHydration, checkStatus]);

useEffect(() => {           // also re-check when student returns from the SPARK tab
  function onFocus() { if (status === 'in_progress' || status === 'assigned' || needsRubricHydration) checkStatus(); }
  window.addEventListener('focus', onFocus);
  return () => window.removeEventListener('focus', onFocus);
}, [...]);
```

---

## 4. `app/api/attempts/spark-launch/route.ts` — JWT handoff (the actual launch)

POST returns `{ launch_url }` (in-app button path); GET does the same flow but
302-redirects (browser-navigation `/launch/spark` path). SAME JWT, SAME claims.

Core builder `buildSparkLaunch` (`:25-113`):
1. Load assignment, verify `student_id === userId` (`:29-36`).
2. Launch prerequisite is `spark_attempt_id` (or legacy `spark_experiment_id`)
   being set — NOT `assignment_mode` (`:43-46`):
   ```ts
   const hasSparkAttempt = !!assignment.spark_attempt_id || !!assignment.spark_experiment_id;
   if (!hasSparkAttempt) return { ok:false, status:400, error:'Spark not provisioned for this assignment' };
   ```
3. Load student (`id, full_name, email, school_id`) + grade from active enrollment.
4. Build `return_url` = `${reqOrigin}/student/homework?assignmentId=${assignment.id}`
   (param name MUST be `assignmentId`, `:85`).
5. **Sign JWT** with `CORE_SPARK_API_SECRET`, 15-minute expiry (`:88-96`):
   ```ts
   const token = jwt.sign({
     core_user_id: student.id,
     core_school_id: student.school_id,
     spark_attempt_id: assignment.spark_attempt_id,
     email: student.email,
     full_name: student.full_name,
     grade,
     return_url: returnUrl,
   }, SPARK_SECRET, { expiresIn: '15m' });
   ```
6. **Launch URL** (`:98-110`):
   ```ts
   const sparkAttemptId = assignment.spark_attempt_id || assignment.spark_experiment_id;
   const redirectPath = `/student/experiment/${sparkAttemptId}`;
   const launchUrl = `${SPARK_API_URL}/api/integration/auth?token=${token}&redirect=${encodeURIComponent(redirectPath)}`;
   ```
   (SPARK auth handoff endpoint is `/api/integration/auth`, NOT `/auth/core`.)
- Env: `SPARK_API_URL` (default `https://spark.inteliflowai.com`), `CORE_SPARK_API_SECRET`.

---

## 5. `app/api/attempts/spark-status/route.ts` — status poll

GET `?assignment_id=...`. Auth → `getUser()`; admin client loads assignment;
verifies `assignment.student_id === user.id` (403 otherwise).

- **Source of truth is `content.spark_completed_at`, NOT `assignment.status`**
  (`:33-55`, prod's status enum can't store `'completed'` — schema drift). If
  `content.spark_completed_at` set, returns cached:
  ```ts
  return NextResponse.json({
    status: 'completed',
    score: content?.spark_score ?? null,
    effort_label: content?.spark_effort_label ?? null,
    completed_at: content?.spark_completed_at ?? null,
    rubric_dimensions: content?.spark_rubric_dimensions ?? null,
    ai_layer: content?.spark_ai_layer ?? null,
    content_quality: content?.spark_content_quality ?? null,
  });
  ```
- Otherwise CORE itself **polls SPARK** server-side (`:58-98`): POST
  `${SPARK_API_URL}/api/integration/core` with `Bearer ${SPARK_SCHOOL_API_KEY}`,
  body `{ action: 'get_attempt_result', core_homework_id: assignmentId }`. On
  `data.status === 'completed' || data.completed`, writes back
  `assignments.content` (`spark_score`, `spark_effort_label`, `spark_completed_at`)
  + `status: 'completed'`, then returns `{status:'completed', score, effort_label, completed_at}`.
- Fallback: `{ status: assignment.status || 'assigned', score:null, effort_label:null, completed_at:null }`.
- Env: `SPARK_API_URL`, `SPARK_SCHOOL_API_KEY` (distinct from `CORE_SPARK_API_SECRET`
  used to SIGN the launch JWT).

---

## 6. Student-facing assignment GET + data shape

### `app/api/attempts/student-homework/route.ts` (detail)
Auth → admin client. With `?assignmentId`, fetch
`assignments.select('*').eq('id',...).eq('student_id', user.id).single()`
(IDOR via `student_id` eq, `:22`); fallback to most-recent assignment if none
(`:25-28`). Loads `lessons.parsed_content` if `lesson_id` set. Loads existing
`homework_attempts` row (`id, status, grade, teacher_notes, ai_feedback, allow_redo`).
Returns `{ assignment, lessonContent, existing }` (`:49`). Note `grade` (renamed
from `score` in migration 055/1c-1).

### `app/api/attempts/homework-list/route.ts` (list)
Auth → admin. enrollments (active) → classes → teacher names. Then
(`:36-40`):
```ts
.from('assignments')
.select('id, content, class_id, created_at, mastery_band, learning_style,
         assignment_mode, spark_experiment_id, spark_attempt_id, status')
.eq('student_id', user.id).in('class_id', targetClassIds)
```
Joins `homework_attempts` (`assignment_id, status, grade, ai_feedback`). Each row
shape (`:52-90`): `assignment_id, title (content.title), class_id, class_name,
teacher_name, created_at, status, score, feedback, assignment_mode,
spark_experiment_id, spark_attempt_id, effort_label, spark_rubric_dimensions,
spark_ai_layer, spark_completed_at, spark_content_quality`.

Status/score source forks on mode (`:62-65`):
```ts
status: a.assignment_mode === 'spark_experiment' ? (a.status || 'assigned') : (attempt?.status || 'pending'),
score:  a.assignment_mode === 'spark_experiment' ? (content.spark_score ?? null) : (attempt?.grade ?? null),
```
All `spark_*` rubric fields are read from the `content` JSON and are null for
non-spark rows.

### `Assignment` type (`components/student/homework/types.ts`)
```ts
export interface Assignment {
  id: string; lesson_id?: string; class_id?: string;
  content: {
    title: string; instructions: string; tasks: AssignmentTask[];
    reading_passage?: string; audio_script?: string;
    diagram_mode?: 'image'|'structured'|'none'; diagram_description?: string;
    diagram_svg_prompt?: string; diagram_image_prompt?: string;
    youtube_search_query?: string; support_note?: string; extension_prompt?: string;
    atl_summary?: string[]; ib_attributes?: string[];
  };
  mastery_band: string; learning_style: string; scaffold_level?: string;
  reteach_needed?: boolean; reteach_completed_at?: string | null;
  spark_attempt_id?: string | null;       // migration 056; render gate
  spark_experiment_id?: string | null;     // legacy
  spark_sync_failed?: boolean | null;
  spark_sync_error?: string | null;
}
export interface AssignmentTask {
  step: number; description: string; type: string;
  strategy?: string; atl_skill?: string; ib_attribute?: string; bloom_level?: string;
}
export interface HomeworkAttemptState { grade: number|null; teacher_notes: string|null; ai_feedback?: string|null; allow_redo: boolean; }
```

### Extension challenge detail (separate, NOT SPARK) — `student/challenges/[id]/page.tsx`
This IS an in-app player but for the "I-Got-This" extension feature: a textarea +
Submit/Skip → POST `/api/attempts/extension-challenges/${id}` → polls same endpoint
(~3s, max 8 tries) for `ai_assessment.student_feedback`. Distinct from SPARK; no JWT,
no launch, in-app text submit. Included as a contrast reference.

---

## 7. Persistence / resume (informs V2 student app durability)

- localStorage `hw-progress-${assignment.id}` written on every change (`page.tsx:156-167`).
- Server draft autosave: 3s-debounced PUT `/api/attempts/homework-draft`
  (`page.tsx:174-202`, migration 064). On load, restore from server first, fall back
  to localStorage (`page.tsx:301-344`). Cross-device + cross-tab so a student can
  switch to the SPARK tab and return without losing CORE homework progress.

---

## NOTES for the V2 designer

- **No `spark_status` column exists in V1.** SPARK lifecycle is derived from
  `assignment.spark_attempt_id` (gate) + `assignment.content.spark_completed_at`
  (source of truth) + polled SPARK API. If V2's grounding/build assumed a discrete
  `spark_status` column, that's a divergence — V1 uses the `content` JSON blob.
- **Two different SPARK secrets:** `CORE_SPARK_API_SECRET` SIGNS the launch JWT;
  `SPARK_SCHOOL_API_KEY` is the Bearer for CORE→SPARK status polling. Keep distinct.
- **SPARK is launch-only on the student side — there is no in-app SPARK player.**
  The S→P→A→R→K experience runs entirely on spark.inteliflowai.com via
  `window.open(launch_url)` / 302. CORE only launches + polls + renders results.
- **V1 DOES build a full in-app player for non-SPARK assignments** (read/tasks
  carousel, Teli tutor chat, hints, canvas, TTS, diagrams, drafts, graded submit).
  V2 Phase-2 scope decision (SPARK-launch-focused vs full player) is exactly the
  gap between "port the launch card + poll" (small) and "port the 1557-line player"
  (large). The SPARK loop needs ONLY: list row → detail → `SparkAssignmentCard`
  (launch button + 60s poll + focus re-check) → `spark-launch` (JWT) →
  `spark-status` (poll). The full player is independent of the SPARK loop.
- **Parallel model is a hard product rule (Barb):** SPARK challenge lives ALONGSIDE
  homework tasks (total work = N tasks + 1 challenge), is rubric-evaluated (7 dims,
  1–4), lives OUTSIDE the gradebook, and is teacher-approved. HW submit is GATED on
  SPARK completion when SPARK is attached (both UI gate `canSubmit` and server gate
  in `/api/attempts/homework-submit`).
- **Launch URL contract V2 must reproduce exactly:** JWT claims
  `{core_user_id, core_school_id, spark_attempt_id, email, full_name, grade,
  return_url}`, 15m expiry; URL
  `${SPARK_API_URL}/api/integration/auth?token=<jwt>&redirect=/student/experiment/<spark_attempt_id>`.
  `return_url` MUST use `assignmentId` query param so SPARK's "back" lands on the
  right CORE homework.
- **Content-quality honesty gate:** when SPARK returns `content_quality` of
  `non_engaged`/`minimal`, the card suppresses the misleading 25% floor and shows
  "try again" copy. V2 should carry this string-boundary behavior (matches V2's
  four-audience/observational discipline).
