# V1 grounding — Student Assignment/Homework Player page

**Source files (read in full):**
- `C:/users/inteliflow/core/app/(dashboard)/student/homework/page.tsx` (1556 lines) — the player UI.
- `C:/users/inteliflow/core/app/(dashboard)/student/homework/actions.ts` (192 lines) — server actions `sendTutorMessage`, `submitHomework`.
- `C:/users/inteliflow/core/components/student/homework/types.ts` — data shapes.
- `C:/users/inteliflow/core/components/student/homework/helpers.ts` — label/type maps + pure helpers.
- `C:/users/inteliflow/core/components/student/homework/StateScreens.tsx` — the gating screens.
- `C:/users/inteliflow/core/components/student/homework/Btn.tsx` — shared button.
- `C:/users/inteliflow/core/components/teli/TeliVoiceButton.tsx` — voice-input control (verifies the `/api/attempts/teli-voice` contract).

This fragment captures **verbatim current behavior only** — no critique, no proposals.

The page component is `HomeworkPage`, exported via `HomeworkPageWrapper` wrapped in `<Suspense>` (because it uses `useSearchParams`). Single-file ~1556-line client component (`'use client'`). Font is `'DM Sans', system-ui, sans-serif` throughout; all styling is **inline `style={{}}` with hardcoded hex** (no token system — this is a V2 porting concern, not a V1 fact).

---

## 1. The complete state machine

### 1a. Top-level gating render order (the "screen" the student sees)

These are sequential `if` returns at the top of the render (page.tsx lines 786–832), so the FIRST matching condition wins:

1. `if (loading) return <LoadingScreen />` — `loading` state, init `true`.
2. `if (showList) return <HomeworkListView ... />` — list/select view (shown when no `assignmentId` param, or when a requested assignment is missing).
3. `if (!assignment) return <NoHomeworkScreen onBack={…} />` — empty/error fallback.
4. `if (homeworkStatus==='submitted') return <SubmittedScreen/> + <FeedbackThumbs event="homework_rated" homeworkType="standard"/>` — already submitted, awaiting grade.
5. `if (homeworkStatus==='graded' && !allowRedo && !done) return <GradedLockedScreen homeworkAttempt onBack/>` — graded + locked (read-only result).
6. `if (done) return <DoneScreen .../>` — just-submitted celebration (confetti).
7. `if (submitting) return <SubmittingScreen/>` — "grading your work" spinner.
8. **Otherwise → the main two-phase player UI** (`read` phase then `tasks` phase).

### 1b. Named state variables (verbatim, page.tsx lines 38–139)

UI / flow:
- `loading: boolean` (init `true`)
- `assignment: Assignment | null`
- `lessonContent: ParsedLesson | null`
- `sessionId: string | null` — the `tutor_sessions` row id
- `currentTaskIndex: number` (init `0`)
- `completedTasks: Set<number>`
- `taskResponses: Record<number, string>` — per-task free-text answer
- `taskImages: Record<number, string>` — per-task image/drawing URL
- `tutorMessages: Record<number, TutorMessage[]>` — per-task Teli chat
- `currentMessage: string` — chat input box
- `tutorLoading: boolean`
- `teliState: TeliState` (init `'idle'`; values seen: `idle | thinking | speaking | celebrating | listening`)
- `hintsRemaining: number` (init `3`)
- `scaffoldDepth: number` (init `0`)
- `submitting: boolean`
- `done: boolean`
- `showConfetti: boolean`
- `imageMode: 'upload' | 'url' | 'draw' | null`
- `urlInput: string`
- `uploadingImage: number | null`
- `lessonExpanded`, `activeVocab`
- `audioUrl: string | null`, `audioLoading: boolean`, `isPlaying: boolean`, `ttsPlayCount` (ref)
- `diagramSvg | diagramImageUrl | diagramMermaid | diagramExcalidraw: string | null`, `diagramLoading`, `diagramFullscreen`, `videoUrl`
- `youtubeQuery: string | null`
- `homeworkStatus: 'none' | 'submitted' | 'graded'` (init `'none'`)
- `homeworkAttempt: HomeworkAttemptState | null`
- `reteachMessage: string | null`
- `submitError: string | null`
- `sparkStatus: 'assigned' | 'in_progress' | 'completed' | 'late' | null`
- `allowRedo: boolean`
- **Two-phase disclosure:** `phase: 'read' | 'tasks'` (init `'read'`), `teliFloatingOpen: boolean`
- **Signal tracking:** `userId`, `schoolId`, `trackingEnabled`
- **Mid-assignment adaptation:** `adaptedTasks: Record<number, AdaptedTask>`, `adaptingTask: number | null`
- **List view:** `showList`, `hwList`, `hwClasses`, `hwSelectedClass` (init `'all'`), `hwLoading`
- **Drawing canvas:** `drawTool: 'pen'|'pencil'|'eraser'|'line'|'text'|'rect'|'circle'|'arrow'` (init `'pen'`), `strokeColor` (init `'#1e293b'`), `strokeWidth` (init `2`), `fillColor` (init `'transparent'`), `showGrid`, `textInput: {x,y,visible}`, `textValue`, `undoLen`, `redoLen`

Signal refs (`useRef`): `taskStartTime`, `taskHelpRequests`, `taskRetries`, `lastHintTime`, `taskSignals` (all `Record<number,…>` or `TaskSignal[]`), `chatEndRef`, `audioRef`, `canvasRef`, `isDrawingRef`, `lastPosRef`, `lineStartRef`, `lastDrawTime`, `shapePreview`, `undoStack`/`redoStack` (`ImageData[]`, capped 20), `textInputRef`, plus draft refs `draftDirtyRef`, `draftSaveTimerRef`.

### 1c. Per-task in-progress sub-states (within `phase === 'tasks'`)

For the **current task** the UI exposes:
- **un-answered** → "Mark Complete" disabled (`canComplete` false)
- **answered, not complete** → `canComplete = (!!taskImages[i] || !!taskResponses[i]?.trim()) && !completedTasks.has(i)` → "Mark Complete" enabled
- **complete** → shows "Completed" (green), advances `currentTaskIndex` to next
- **hint chat open** → Teli panel always rendered below the task card; `hintsRemaining` pill; "out of hints" message when `hintsRemaining<=0 && taskMessages.length>0`
- **adapting** → `adaptingTask===currentTaskIndex` spinner; **adapted** → `adapted` banner
- **all tasks done** → `allTasksDone = completedTasks.size===tasks.length` → green Submit panel (or SPARK-blocking amber panel; or partial-progress informational note)

There is **no explicit "I got this" control** in this page. The closest is the per-task **"Mark Complete"** button (`handleTaskComplete`) and the **"Start Tasks"** CTA that transitions `phase: 'read' → 'tasks'`. (If "I got this" exists in V1, it is on a different surface — e.g. the quiz/reteach flow — not in this file.)

### 1d. The two-phase progressive disclosure (the core flow)

- **Phase `read`** (lines ~973–1120): reading passage (or lesson summary fallback), diagram, YouTube link, and a centered **"Ready to start?"** CTA card. `<Btn onClick={()=>setPhase('tasks')}>` enters tasks.
- **Phase `tasks`** (lines ~1125–1545): "Back to passage" link; progress indicator (`Task X of Y`, dot rail clickable via `handleTaskStart(i)`); collapsed lesson extras (`ProgressiveSection`); a **268px sidebar / 1fr task-area grid**; the task card; the Teli tutor panel; the submit panel; a floating Teli button.
- Auto-resume effect: on mount, if `completedTasks.size>0 || taskResponses` non-empty and `phase==='read'`, it forces `setPhase('tasks')`.

---

## 2. Question/task types & how each answer is captured

**There is exactly ONE answer-capture primitive per task: a free-text `<textarea>`** (page.tsx lines 1431–1436), bound to `taskResponses[currentTaskIndex]`. **No MCQ, no numeric input, no choice buttons exist in this page.** Tasks are open-response writing/drawing/explaining prompts. The "type" of a task only changes the placeholder, the colored type pill, and whether the visual/voice panels appear.

`task.type` is a free-form string. Known values come from `TASK_TYPE` map (helpers.ts): **`read`, `write`, `draw`, `discuss`, `create`, `analyze`** (each maps to `{bg,color,border}`). The type pill renders `currentTask.type` capitalized (line 1319).

### Answer-capture branches:

- **Free-text (all tasks)** — `<textarea value={taskResponses[currentTaskIndex]||''} onChange={…}>` rows=`isVisualTask?3:6`. Placeholder switches on type: visual → `answerPlaceholderVisual`, `discuss` → `answerPlaceholderDiscuss`, `analyze` → `answerPlaceholderAnalyze`, else `answerPlaceholderDefault`.
- **Drawing / image (visual tasks)** — gated by `isVisualTask(currentTask)` (lines 1336–1429). `isVisualTask` (helpers.ts): `t.type==='draw' || t.type==='create' || description includes any of: diagram|drawing|draw|visual|sketch|label`. Shows three capture modes selectable into `imageMode`: **`upload` | `draw` | `url`** (see §4). Result stored as a URL in `taskImages[i]`.
- **Voice / "explain aloud" tasks** — rendered when `currentTask.type === 'discuss' || /explain aloud|speak|record|say|tell|aloud/i.test(displayDescription)` (lines 1260–1268). A `<TeliVoiceButton size={48}>` whose `onTranscript` **appends** the transcript into `taskResponses[currentTaskIndex]` (newline-joined). (Distinct from the tutor-chat voice button at the bottom of the Teli panel.)

`canComplete` requires either a saved image OR non-empty trimmed text. Submitting reconstructs answers from `taskResponses` + `taskImages` (see §7).

Task metadata fields rendered: `currentTask.strategy` ("This task practices <strategy>"), `currentTask.atl_skill`, `currentTask.bloom_level`. Adapted description (`adaptedTasks[i].adapted_description`) overrides `currentTask.description` as `displayDescription`.

---

## 3. The hint-ladder UX (as driven from this page)

### 3a. Client-side mechanics

- **Max hints = 3 per task.** `hintsRemaining` inits `3`; reset to `3` on every task switch (`handleTaskStart`, `handleTaskComplete` → next task). `scaffoldDepth` inits `0`, reset to `0` per task.
- **Hard client gate:** both `handleAskTutor()` and `handleVoiceTranscript()` `return` early if `hintsRemaining <= 0`. (Comment at line 674: "Hard client-side cap of 3 hints per task… guards against any server/client mismatch.")
- A hint is "requested" simply by **sending any message to Teli** — every chat message is treated as a help request (`isHelpRequest = true` is hardcoded in the `sendTutorMessage` call). There is no separate "give me a hint" button distinct from the chat box; typing/sending OR speaking into the tutor panel consumes a hint.
- Per-message bookkeeping: `taskHelpRequests.current[idx]++`, `trackEvent('hint_request', {taskIndex, taskDescription[, input_method:'voice']})`, push user message into `tutorMessages[idx]`, set `teliState='thinking'`.

### 3b. The nudge→cue→step→blocked ladder (server-authoritative, in `actions.ts`)

`sendTutorMessage(sessionId, message, taskIndex, taskDescription, isHelpRequest=true, messageHistory)`:

- `HINT_LADDER = ['nudge', 'cue', 'step', 'answer_blocked'] as const` (actions.ts line 41).
- On a help request: `hintType = HINT_LADDER[Math.min(newScaffoldDepth, 3)]`; then `newScaffoldDepth = Math.min(newScaffoldDepth+1, 3)`; `hintCount++`, `helpRequestCount++`.
- So scaffold_depth `0→nudge, 1→cue, 2→step, 3→answer_blocked`.
- `HINTS` instruction strings injected into the system prompt (actions.ts lines 12–17):
  - `nudge`: "Ask a thought-provoking question pointing right direction. Do NOT give any part of the answer."
  - `cue`: "Narrow focus with a key concept. Do not give the answer."
  - `step`: "Give step-by-step scaffold. Do not give the final answer."
  - `answer_blocked`: "Student used all hints. Encourage effort. No direct answer."
- **Return shape consumed by the page:** `{ response, hint_type, scaffold_depth, hints_remaining, help_request_count }` where `hints_remaining = Math.max(0, 3 - newScaffoldDepth)`.
- Page consumes: `data.response`, `data.hint_type`, `data.scaffold_depth` → `setScaffoldDepth`, `data.hints_remaining` → `setHintsRemaining`. The assistant message stores `hint_type` so the bubble shows a colored label.

### 3c. Exact fields sent to the tutor (positional args to the server action)

`sendTutorMessage(sessionId, currentMessage, idx /*taskIndex*/, task.description /*taskDescription*/, true /*isHelpRequest*/, history)` where `history = (tutorMessages[idx]||[]).map(m=>({role:m.role, content:m.content}))`.

Inside the action it builds an OpenAI `chat.completions.create` with `model: OPENAI_GEN_MODEL`, `temperature: 0.7`, `max_tokens: 500`, system = `withLocaleInstruction(teliPrompt + assignmentContext + hintInstruction)`. It fetches `student_model` (`dominant_style`, `struggle_topics`, `preferred_scaffold_level`) for `buildTeliPrompt`. The `assignmentContext` is `tutorSystemPrompt(JSON.stringify(session.assignments.content), '')`. Adds `diagramContext` from `content.diagram_description`. Persists both turns to `tutor_messages` and updates `tutor_sessions` (`scaffold_depth`, `help_request_count`, `hint_count`, `last_activity_at`).

### 3d. Hint labels & colors shown in the chat (helpers.ts)

`buildHintLabel(t)` maps `nudge→hintNudge`, `cue→hintCue`, `step→hintWalkthrough`, `answer_blocked→hintsExhausted`. `HINT_COLOR` map: `nudge:'#eef2ff', cue:'#fffbeb', step:'#faf5ff', answer_blocked:'#fef2f2'`. The chat bubble shows the hint label (`HINT_LABEL[msg.hint_type]`) and a `<FeedbackThumbs event="teli_hint_rated" hintIndex={i}>` under assistant hints.

### 3e. Adaptation trigger tied to hints

After **≥2 hint requests** on a task (`hintCount >= 2 && !adaptedTasks[idx]`), the page auto-calls `adaptTask(idx)` (both chat + voice paths). See §8 for the `/api/attempts/homework-adapt` payload.

---

## 4. Drawing canvas

**Present — hand-rolled on a raw HTML `<canvas>` element** (NOT a third-party library). `<canvas ref={canvasRef} width={560} height={320}>` (line 1407). Shown only inside the visual panel when `imageMode === 'draw'` (entered from the "Draw here" option button, which also fires `trackEvent('canvas_start')`).

- **Tools** (`drawTool`): `pencil` (velocity-variable width + alpha via quadratic curves), `pen` (solid), `text` (click places an overlay `<input>`, committed to canvas via `commitText` with fontSize map `{1:14,2:18,4:24,7:32}`), `eraser` (white stroke, width×6), `line`, `rect`, `circle`, `arrow` (shapes use a saved `shapePreview` ImageData for live preview; shift-key constrains square/circle).
- **Controls:** stroke width `[1,2,4,7]`; 8 preset stroke colors `['#1e293b','#6366f1','#dc2626','#16a34a','#9333ea','#ea580c','#0891b2','#000000']` + custom `<input type="color">`; fill color (rect/circle only) `['transparent','#6366f1','#dc2626','#16a34a','#fbbf24','#fff']`; grid toggle (`showGrid`, SVG overlay); **Undo/Redo** (ImageData stacks capped 20; Ctrl/Cmd+Z and Ctrl/Cmd+Y / Ctrl+Shift+Z keyboard shortcuts); Clear.
- **Input:** mouse (`onMouseDown/Move/Up/Leave`) AND touch (`onTouchStart/Move/End`, `touchAction:'none'`, single-finger only). Coords scaled from displayed size to the 560×320 backing store.
- **Capture/save:** `saveCanvasAsImage(idx)` → `canvas.toBlob(..., 'image/png')` → uploads to **Supabase Storage bucket `student-work`**, path `${user.id}/task-${idx}-drawing-${Date.now()}.png`, then `getPublicUrl` → sets `taskImages[idx] = publicUrl` and appends `'[Canvas drawing saved]'` sentinel to `taskResponses[idx]`.
- The saved URL flows into the submit payload as `diagram_url` and per-step `image_url` (see §7). **The drawing is saved as a flattened PNG URL — no stroke/vector data is persisted.**

Other image-capture modes share the same `taskImages[idx]` slot:
- **`upload`**: `<input type="file" accept="image/*" capture="environment">` → `handleImageUpload` → Storage `student-work` path `${user.id}/task-${idx}-${Date.now()}.${ext}` → `getPublicUrl`. Sentinel `'[Image uploaded]'`.
- **`url`**: paste a URL → `handleUrlSubmit` sets `taskImages[idx]=url`. Sentinel `'[Image from URL]'`.

---

## 5. TTS / voice (read-aloud + voice-input)

### 5a. Read-aloud (TTS) — passage audio

- `generateAudio(text)` → **`POST /api/attempts/tts`**, body `{ text }`, expects an **audio blob** response → `URL.createObjectURL(blob)` → `audioUrl`, played via a single `<audio ref={audioRef}>`.
- Auto-generated on assignment load from `content.audio_script || content.reading_passage` (setupAssignment line 353–354).
- UI: a "Listen"/"Pause" pill (top-right of passage card) and a small circular play button in the collapsed lesson-extras. Tracks `trackEvent('tts_play',{section:'passage'})` first play, `trackEvent('tts_replay',{section:'passage',playCount})` on replays.
- Teli's chat replies are also spoken via `teliSpeak(text, onStart, onEnd)` (from `@/lib/teli/identity`) which toggles `teliState` `speaking↔idle`. Clicking an assistant bubble re-speaks it (`onClick={()=>teliSpeak(msg.content)}`). This is a browser-speech / identity-module path, **not** the `/api/attempts/tts` endpoint.

### 5b. Voice input (speech-to-text)

Two `<TeliVoiceButton>` instances:
1. In the Teli tutor panel (`size={42}`, `onTranscript={handleVoiceTranscript}`) — voice asks Teli (consumes a hint).
2. In "explain aloud"/discuss tasks (`size={48}`) — `onTranscript` appends to `taskResponses[currentTaskIndex]`.

`TeliVoiceButton` records via `MediaRecorder` (prefers `audio/webm`, falls back `audio/mp4`; max 30s, min 500ms), builds a `FormData` with field name **`audio`** (filename `voice.webm`/`voice.mp4`), and does **`POST /api/attempts/teli-voice`** (multipart, no JSON). Response consumed: `data.transcript` (success), or `data.error` (`'too_short'` → "hold longer"; other → "couldn't hear"). `onStateChange` drives `teliState` (`listening`/`thinking`/`idle`).

`handleVoiceTranscript(transcript)`: same hint gate (`hintsRemaining<=0` returns), `taskHelpRequests++`, `trackEvent('hint_request', {…, input_method:'voice'})`, pushes a user message with `input_method:'voice'`, then the same `sendTutorMessage(... isHelpRequest=true ...)` path.

---

## 6. Draft autosave

**Two parallel persistence layers, both keyed off the same effect deps `[completedTasks, taskResponses, taskImages, currentTaskIndex, phase, assignment]`:**

### 6a. localStorage (immediate fast-path) — page.tsx lines 156–167
- On every change, `localStorage.setItem('hw-progress-${assignment.id}', JSON.stringify({ completedTasks:[...set], taskResponses, taskImages, currentTaskIndex, phase }))`.
- Cleared after submission (`localStorage.removeItem`).

### 6b. Server draft (durable, cross-device) — page.tsx lines 174–202
- **3-second debounce** (`setTimeout`, cleared on each change). A `draftDirtyRef` sentinel skips the very first run after `assignment` loads (avoids a redundant PUT right after hydration).
- **`PUT /api/attempts/homework-draft`**, JSON body `{ assignment_id: assignment.id, draft_state: { completedTasks:[…], taskResponses, taskImages, currentTaskIndex, phase } }`.
- Failures are swallowed (localStorage remains the fallback).

### 6c. Restore on load — `setupAssignment` lines 301–344
- **`GET /api/attempts/homework-draft?assignment_id=${a.id}`** → `{ draft }` where `draft.draft_state` has the same shape; hydrates `completedTasks` (Set), `taskResponses`, `taskImages`, `currentTaskIndex`, `phase`. Shows a "resuming draft" toast (`reteachMessage`, auto-dismiss 3s) if there was completed work.
- If the server fetch fails / no draft, falls back to `localStorage['hw-progress-${a.id}']`.

(Migration 064 + `/api/attempts/homework-draft` is the cited source.)

---

## 7. Submit + redo

### 7a. Submit firing (`handleSubmit`, page.tsx lines 736–783)

Triggered by the green Submit button (only rendered when `allTasksDone && canSubmit`). Steps:
1. `setSubmitting(true)`.
2. Backfill `taskSignals.current[i]` for any task without a signal (uses `completedTasks.has(i)`, timing, help counts, `recovery_pattern:'none'`).
3. Compute `diagramUrl = first taskImages value that is a real URL (not a '[…]' sentinel)`.
4. Compute `responseText = taskResponses entries sorted by index, joined as "Task N: <text>", excluding '[Image…]' sentinels` (or `null`).
5. Compute `responsesByStep: Record<string,{text, image_url?}>` keyed by `task.step` (the structured-grading path), cleaning sentinel text/images.
6. `flushAndCompute()` (V5 signals) — fire-and-forget.
7. `submitHomework(sessionId, taskSignals.current)` server action — fire-and-forget; updates `tutor_sessions` (status `completed`, `tasks_completed/total`, `scaffold_dependency_score`) and inserts one `signal_events` row per task (`signal_family:'behavioral'`, `event_type:'homework_task'`, `source_module:'homework'`, `schema_version:'v1'`, `payload:task`).
8. **`POST /api/attempts/homework-submit`** (awaited) — the real grade.

**Exact `/api/attempts/homework-submit` request body (every field):**
```
{
  assignment_id: assignment.id,
  class_id:      assignment.class_id,
  diagram_url:   diagramUrl,          // string | null
  response_text: responseText,        // string | null  (flat "Task N: …" blob, legacy)
  responses:     responsesByStep      // { [stepNumber]: { text, image_url? } }  (structured)
}
```

**Response consumed (`hwData`):** `hwData.success`; grade from `hwData.grade ?? hwData.attempt?.grade ?? null`; `teacher_notes` from `hwData.attempt?.teacher_notes`; AI feedback from `hwData.feedback ?? hwData.attempt?.ai_feedback`; `hwData.reteach_completion` (→ "your teacher will confirm your reteach" message). On `!ok || !success`: `submitError = hwData.detail || hwData.error || HTTP <status>`.
After response: `setHomeworkStatus('graded')`, `setHomeworkAttempt({grade, teacher_notes, ai_feedback, allow_redo:false})`, `setDone(true)`, `setSubmitting(false)`, `setShowConfetti(true)`, clear localStorage.

### 7b. What the graded view shows the student

`DoneScreen` (post-submit) and `GradedLockedScreen` (returning to a graded+locked assignment) both:
- **NEVER show the raw % grade.** Per "Option D reversal (Barb 2026-05-11)" they render `hwGradePill(homeworkAttempt.grade)` → a qualitative pill `{label, detail, color, bg, border}` only. (Teacher/parent/gradebook keep the raw grade on their own surfaces; HW grades remain visible to *students* as a band/pill, unlike quiz scores which are stripped entirely.)
- Show `ai_feedback` ("CORE Feedback") and `teacher_notes` ("Teacher Feedback") boxes when present.
- `DoneScreen` also fires `<ConfettiCelebration xpEarned={150}>`, shows `reteachMessage`, `submitError`, and a "teacher may adjust" note. `GradedLockedScreen` shows a "homework locked" note + back button.

### 7c. Redo / allow_redo affordances

- `allowRedo: boolean` is read from the existing attempt's `allow_redo === true` (set by the teacher). When true, `setupAssignment` does **not** short-circuit to the graded screen — the student re-enters the editable player.
- A top banner renders when `allowRedo` (line 866): "Your teacher has unlocked this assignment for a redo." + (Option-D) qualitative pill "Previous: <label>" (no number; `homeworkAttempt.grade` is converted via `hwGradePill`, never shown raw).
- The graded-locked gate is specifically `homeworkStatus==='graded' && !allowRedo && !done` — so `allowRedo` is what unlocks editing.
- There is **no `is_redo` flag in the submit payload** in this page — redo just re-submits via the same `/api/attempts/homework-submit` body (`allow_redo:false` is set locally after resubmit). The server distinguishes redo by the existing attempt row.

### 7d. SPARK submit gating (Barb 2026-05-05)

`sparkRequired = !!assignment.spark_attempt_id && assignment.spark_sync_failed !== true`. `sparkComplete = sparkStatus==='completed'` (lifted from `<SparkAssignmentCard onStatusChange={setSparkStatus}>`). `sparkBlocking = sparkRequired && !sparkComplete`. `canSubmit = allTasksDone && !sparkBlocking`. When blocking, an amber "Finish your Spark Challenge to submit" panel replaces the green submit panel. (Server enforces independently.) The SPARK card renders **once at the top of the page**, parallel/additive — SPARK is NOT a homework task.

---

## 8. Every external fetch the page makes (METHOD path + request fields → response fields consumed)

1. **`GET /api/attempts/homework-list`** (optional `?class_id=`) → consumes `{ classes:[{id,name}], homework:[{assignment_id,title,class_id,class_name,teacher_name,created_at,status,score}] }`. (`loadHomeworkList`)
2. **`GET /api/attempts/student-homework?assignmentId=<id>`** → consumes `{ assignment, lessonContent, existing:{ status, score?, grade?, teacher_notes, ai_feedback, allow_redo, id? } }`. (`loadAssignment` / `loadSpecificAssignment`). Note `grade` is PostgREST-aliased to `score`; the page reads `grade ?? score`.
3. **`GET /api/attempts/homework-draft?assignment_id=<id>`** → `{ draft:{ draft_state:{ completedTasks, taskResponses, taskImages, currentTaskIndex, phase } } }`. (restore)
4. **`PUT /api/attempts/homework-draft`** — body `{ assignment_id, draft_state:{ completedTasks, taskResponses, taskImages, currentTaskIndex, phase } }`. (autosave; response ignored)
5. **`POST /api/attempts/tts`** — body `{ text }` → **audio blob** (consumed via `URL.createObjectURL`). (read-aloud)
6. **`POST /api/attempts/diagram`** (optional `?video=true`) — body `{ prompt, title, image_prompt, mode }` → consumes `{ svg?, image_url?, video_url?, mermaid?, excalidraw?, engine? }`. (`generateDiagram`; supplemental — a non-200 is logged and ignored)
7. **`POST /api/attempts/homework-adapt`** — body `{ task_description, task_type, mastery_band, learning_style, hint_count, assignment_title }` → consumes `{ adapted_description, scaffold_note, difficulty, encouragement }` (the `AdaptedTask`). (`adaptTask`)
8. **`POST /api/attempts/teli-voice`** — **multipart FormData** field `audio` (webm/mp4 blob) → consumes `{ transcript } | { error }`. (via `TeliVoiceButton`)
9. **`POST /api/attempts/homework-submit`** — body `{ assignment_id, class_id, diagram_url, response_text, responses }` → consumes `{ success, grade?, feedback?, reteach_completion?, attempt:{ grade?, teacher_notes?, ai_feedback? }, detail?, error? }`. (`handleSubmit`)

**Server actions (not fetches — RPC-style):**
- `sendTutorMessage(sessionId, message, taskIndex, taskDescription, isHelpRequest, messageHistory)` → `{ response, hint_type, scaffold_depth, hints_remaining, help_request_count }`.
- `submitHomework(sessionId, taskSignals[])` → `{ completed, tasks_completed, tasks_total }`.

**Direct Supabase client calls (not REST routes):**
- `supabase.auth.getUser()` (gates the whole page; redirects `/login` if unauthenticated).
- `supabase.from('tutor_sessions')` — `select` active session by `assignment_id + student_id + status='active'`; `insert` a new one with `{ assignment_id, student_id, class_id, lesson_id, mastery_band, learning_style, status:'active', started_at, scaffold_depth:0, help_request_count:0, hint_count:0 }`.
- `supabase.from('users').select('school_id')` (for signal tracking `schoolId`).
- `supabase.storage.from('student-work').upload(...)` + `.getPublicUrl(...)` — image upload + canvas PNG save.

**Event tracking (`useEventTracker`, context `'homework'`):** `homework_resume`, `homework_rated` (via FeedbackThumbs), `hint_request` (`{taskIndex, taskDescription[, input_method]}`), `question_next`, `tts_play`/`tts_replay`, `diagram_view`, `canvas_start`, `teli_hint_rated`. `trackQuestionAttempt({questionId:task.description, questionIndex, isCorrect:true, timeTakenMs, changeCount, hintsUsed})` on task complete. `flushAndCompute()` on submit. **Note: `trackQuestionAttempt` hardcodes `isCorrect:true`** — there is no per-task correctness scoring in the runner; grading is entirely server-side post-submit.

**sessionStorage gate:** on `loadAssignment`, if `sessionStorage.getItem('quiz_in_progress')==='true'`, it alerts and redirects to `/student` (homework is blocked during an active quiz).
