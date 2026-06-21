# V1 Grounding — Teli AI Tutor + Hint Ladder (Epic 2 Assignment Player)

Verbatim current-code facts from V1 (`C:/users/inteliflow/core`). No critique, no proposals — this is "what exists" for a V2 spec author. All paths absolute under the V1 repo unless noted.

> **CRITICAL ARCHITECTURE FACT — there are TWO Teli surfaces and FOUR tutor code paths.** They differ in model, prompt, persistence, and behavior. The non-SPARK Assignment Player (the Epic-2 target) uses the **server-action path**, NOT the API routes. Do not assume one canonical tutor implementation.

---

## 0. The four tutor code paths (which is which)

| Path | File | Surface that calls it | Model | System prompt | Persists signal_events? |
|---|---|---|---|---|---|
| **A. Server action `sendTutorMessage`** | `app/(dashboard)/student/homework/actions.ts` | **THE Assignment Player** (`student/homework/page.tsx`) — this is the Epic-2 reference | `OPENAI_GEN_MODEL` = `gpt-4o` | `buildTeliPrompt()` + `tutorSystemPrompt()` + per-level HINT | **NO** (only `tutor_messages` + `tutor_sessions` update) |
| B. API `POST /api/attempts/tutor` | `app/api/attempts/tutor/route.ts` | (legacy/alt; 4748-byte minified-style route) | `OPENAI_VOICE_MODEL` = `gpt-4o` | `tutorSystemPrompt()` only | NO |
| C. API `POST /api/tutor-message` | `app/api/tutor-message/route.ts` | (the fully-commented "canonical" route — fullest version) | `OPENAI_VOICE_MODEL` = `gpt-4o` | `tutorSystemPrompt()` only | **YES** (inserts `signal_events` `event_type:'tutor_interaction'`) |
| D. API `POST /api/tutor-start` | `app/api/tutor-start/route.ts` | session creator (pairs with C) | — (no LLM call) | — | NO (writes `audit_logs`) |
| **E. Free-chat `POST /api/attempts/teli-chat`** | `app/api/attempts/teli-chat/route.ts` | `components/student/TeliChat.tsx` — **standalone revision chat, NOT the assignment player** | `OPENAI_VOICE_MODEL` = `gpt-4o` | inline `systemPrompt` (different, see §5) | NO — explicitly "ephemeral, not tracked" |

**The Assignment Player actually wires path A.** `page.tsx` imports `{ sendTutorMessage, submitHomework } from './actions'` (line 6) and calls `sendTutorMessage(...)` in both `handleAskTutor` (line 688) and `handleVoiceTranscript` (line 659). The API routes B/C/D exist in parallel and were the earlier mechanism; B/C/D and the player's action all duplicate the same hint-ladder logic by hand.

---

## 1. Hint ladder — VERBATIM

The ladder is **4 levels**, identical array in all paths:

```ts
const HINT_LADDER = ['nudge', 'cue', 'step', 'answer_blocked'] as const;
```

**Escalation logic** (identical in actions.ts, /api/attempts/tutor, /api/tutor-message):
```ts
let newScaffoldDepth = session.scaffold_depth || 0;   // starts 0
if (is_help_request) {
  helpRequestCount += 1;
  hintType = HINT_LADDER[Math.min(newScaffoldDepth, 3)];   // pick BEFORE incrementing
  newScaffoldDepth = Math.min(newScaffoldDepth + 1, 3);    // then advance, capped at 3
  hintCount += 1;
}
// returned:
hints_remaining: Math.max(0, 3 - newScaffoldDepth)
```
- `hint_type` is set **only when `is_help_request === true`**. A normal (non-help) message gets `hint_type: null` and does not advance scaffold depth.
- So the sequence per task is: 1st help → `nudge` (depth→1), 2nd → `cue` (depth→2), 3rd → `step` (depth→3), 4th → `answer_blocked` (depth stays 3). `hints_remaining` goes 2,1,0,0.
- `getHintType(d)` helper (routes B/C): `HINT_LADDER[Math.min(d, 3)]` / `HINT_LADDER[Math.min(scaffoldDepth, HINT_LADDER.length - 1)]`.

### Per-level prompt instructions — VERBATIM (3 different copies exist)

**(A) Player server action `actions.ts` `HINTS` (terse):**
```ts
const HINTS = {
  nudge: 'Ask a thought-provoking question pointing right direction. Do NOT give any part of the answer.',
  cue: 'Narrow focus with a key concept. Do not give the answer.',
  step: 'Give step-by-step scaffold. Do not give the final answer.',
  answer_blocked: 'Student used all hints. Encourage effort. No direct answer.',
};
// injected as:  `\n\nCURRENT TASK: ${taskDescription}${diagramContext}\nHINT: ${HINTS[hintType]}`
// when NO hintType:  `\n\nCURRENT TASK: ${taskDescription}${diagramContext}`
```

**(B) `/api/attempts/tutor` `hintInstructions` (terse, near-identical):**
```ts
nudge: 'Ask a thought-provoking question pointing the right direction. Do NOT give any part of the answer.',
cue: 'Narrow the focus with a key concept or vocabulary term. Do not give the answer.',
step: 'Give step-by-step scaffold. Walk through the approach. Do not give the final answer.',
answer_blocked: 'Student used all hints. Encourage effort. Summarize key concept for next time. No direct answer.'
// injected as:  `\n\nCURRENT TASK: ${task_description}\nHINT: ${hintInstructions[hintType]}`
```

**(C) `/api/tutor-message` `buildHintInstruction()` (verbose, fullest):**
```ts
case 'nudge':
  return `Give a gentle nudge — ask a thought-provoking question that points the student in the right direction without revealing anything. Do NOT give any part of the answer.`;
case 'cue':
  return `Give a cue — provide a hint that narrows the focus significantly. You can reference a key concept or vocabulary term that is relevant. Still do not give the answer.`;
case 'step':
  return `Break it down — give a specific step-by-step scaffold. Walk the student through how to approach this task piece by piece. Still do not give the final answer.`;
case 'answer_blocked':
  return `The student has used all available hints. Encourage them to do their best with what they know. Acknowledge their effort. Do NOT give the answer directly — instead summarize the key concept they need to focus on for next time.`;
// injected as:  `\n\nCURRENT TASK: ${task_description}\nHINT INSTRUCTION: ${buildHintInstruction(...)}`
```

---

## 2. System prompts — VERBATIM

### 2a. `tutorSystemPrompt(assignmentContent, lessonSummary)` — `lib/openai/prompts.ts:1098`
Used by ALL of A/B/C (the assignment-tutor base prompt).
```
You are a helpful AI tutor for a K-12 student using the Inteliflow Learning Strategy approach.
Your job is to guide, hint, and ask questions — NEVER give the direct answer.
Use Socratic questioning and scaffold thinking step by step.

ASSIGNMENT:
${assignmentContent}

LESSON CONTEXT:
${lessonSummary}

Rules you MUST always follow:
1. NEVER state the direct answer
2. Use Socratic questions to guide thinking
3. Give hints that point the right direction
4. Acknowledge effort and encourage progress
5. If asked "just tell me the answer" — redirect kindly using the Inteliflow strategy approach
6. Keep responses short and age-appropriate
7. If stuck: break the problem into smaller steps using scaffolding
8. Reference the learning strategy being used when helpful (e.g., "Let's try the Knowledge Bridge strategy — what do you already know about this?")
Speak to a student, not a teacher. Be warm and encouraging.
```
- In the **player action** it is called with `tutorSystemPrompt(JSON.stringify(session.assignments?.content || {}), '')` — note **lessonSummary is passed empty `''`** in the player path (routes B/C pass the lesson `parsed_content`).

### 2b. `TELI_SYSTEM_PROMPT` + `buildTeliPrompt(opts)` — `lib/teli/prompts.ts`
**Only the player action (A) prepends this Teli-personality prompt**, before `tutorSystemPrompt`. Server-safe (no `'use client'`).
```
You are Teli, a warm and encouraging Socratic AI tutor for K-12 students on the CORE learning platform.

Core rules:
- NEVER reveal answers directly — always guide with questions
- Keep responses under 3 sentences
- Adapt tone to the student's frustration level: calm and patient when frustrated, enthusiastic when engaged
- Always end with an encouraging question or statement
- Use age-appropriate language
- Be warm, supportive, and celebrate effort over correctness
- When a student is stuck on the same step twice, offer a DIFFERENT approach — not the same explanation louder. Try a fresh angle (analogy, visual, simpler example, or a totally different strategy). One-way-only teaching is i-Ready's failure mode; you are the opposite of that.
- When the student successfully unblocks themselves, name the THINKING move they used ("Asking 'what changes when X' is a great strategy"). This is how they build self-knowledge of how they learn.
```
`buildTeliPrompt(opts)` then appends, conditionally, from `student_model` (`dominant_style`, `struggle_topics`, `preferred_scaffold_level`):
- If `dominantStyle`: `\n\nThis student's dominant learning style is ${style}. ${STYLE_HINTS[style]}` where
  `STYLE_HINTS = { visual: 'Suggest drawing diagrams, charts, or visual representations.', auditory: 'Suggest saying the answer aloud or explaining it as if teaching someone.', kinesthetic: 'Suggest acting it out, building a model, or using physical movement.', text: 'Suggest writing a summary, making bullet notes, or creating a list.', emerging: 'Use varied approaches since the learning style is still developing.' }`
- If `struggleTopics?.length`: `\nThis student struggles with: ${topics.slice(0,5).join(', ')}. Reference these gently if relevant.`
- If `scaffoldLevel`: `\nCurrent scaffold level: ${level}. Adjust hint depth accordingly — ${depth}.` where depth = high→"more guided hints with step-by-step support", low→"open-ended questions only, minimal guidance", else "moderate guidance with some structure".

### 2c. Player final system message assembly (actions.ts lines 69–93)
```ts
const teliPrompt = buildTeliPrompt(teliOpts);
const assignmentContext = tutorSystemPrompt(JSON.stringify(session.assignments?.content || {}), '');
const diagramContext = assignmentData.diagram_description
  ? `\nDIAGRAM SHOWN TO STUDENT: ${assignmentData.diagram_description}. If the student says the diagram is wrong or doesn't match, acknowledge the issue and help them understand the concept using words instead. Do not pretend the diagram is correct if the student says it isn't.`
  : '';
const hintInstruction = hintType
  ? `\n\nCURRENT TASK: ${taskDescription}${diagramContext}\nHINT: ${HINTS[hintType]}`
  : `\n\nCURRENT TASK: ${taskDescription}${diagramContext}`;

await openai.chat.completions.create({
  model: OPENAI_GEN_MODEL,   // gpt-4o
  messages: [
    { role: 'system', content: withLocaleInstruction(teliPrompt + '\n\n' + assignmentContext + hintInstruction) },
    ...messageHistory,       // [{role:'user'|'assistant', content}]
    { role: 'user', content: message },
  ],
  temperature: 0.7,
  max_tokens: 500,
});
```
`withLocaleInstruction()` from `@/lib/i18n/locale` wraps for locale (CORE 'en' / EduFlux 'pt').

---

## 3. Model IDs, token limits, resilience

`lib/ai/models.ts` (single source of truth, calibration-locked):
- `CLAUDE_GRADING_MODEL = 'claude-sonnet-4-6'` (grading/differentiation — NOT tutor)
- `OPENAI_GEN_MODEL = 'gpt-4o'` — **used by the player tutor action (A)** + generation paths
- `OPENAI_VOICE_MODEL = process.env.OPENAI_VOICE_MODEL || 'gpt-4o'` — used by B/C/E + all voice/tone surfaces; env-overridable "pilot lever"
- `tokenLimitParams(model, n)` returns `{max_tokens}` for gpt-4/gpt-3, `{max_completion_tokens}` for newer (gpt-5/o-series). `usesLegacyTokenParam(model)` = `/^(gpt-4|gpt-3|ft:gpt-[34])/`.

**max_tokens per path:** player action A = `500` (hardcoded). Route B/C = `tokenLimitParams(OPENAI_VOICE_MODEL, 500)`. Free-chat E = `200` (hardcoded). Temperature `0.7` everywhere.

`lib/openai/resilient.ts` → `resilientChatCompletion(params, {timeoutMs})`: exp-backoff retry, default `maxRetries=3, initialDelayMs=1000, maxDelayMs=10000, timeoutMs=30000`; retries on 429/≥500/timeout; returns `null` on terminal failure (callers must handle null). **Free-chat E uses this with `timeoutMs:15000`. The player action A and routes B/C call `openai.chat.completions.create` DIRECTLY (no resilient wrapper).**

---

## 4. TeliChat.tsx component contract (free-chat, NOT the player — but the closest reusable component)

`components/student/TeliChat.tsx` (260 lines, `'use client'`). This is the **standalone revision chat modal**, not the in-assignment tutor (the player renders its own inline panel — §6).

- **Props:** `interface TeliChatProps { onClose: () => void; }` — only `onClose`.
- **Message shape:** `interface Message { role: 'user' | 'assistant'; content: string; }` (no hint_type — free chat has no ladder).
- **State:** `messages`, `input`, `loading`, `limited` (rate-limit hit), `voiceState: TeliState`, refs `chatEndRef`, `inputRef`, `askedByVoice`.
- **No streaming** — `await fetch(...).json()`, single response. Shows a 3-dot pulse "thinking" loader while awaiting.
- **Endpoint + payload:** `POST /api/attempts/teli-chat` with `{ message: userMsg, conversation_history: messages }`. Reads back `{ response, limited? }`.
- **Auto-speak:** if the question came via voice (`askedByVoice.current`), it `teliSpeak(teliResponse)` automatically; text questions stay silent but every assistant bubble is tap-to-hear (`onClick={() => teliSpeak(msg.content)}`).
- **Voice in:** `<TeliVoiceButton onTranscript={handleVoiceTranscript} onStateChange={setVoiceState} disabled={loading||limited} />`.
- **UI:** fixed bottom-sheet modal (slideUp), `TeliAvatar` header with state `loading?'thinking':voiceState`, 4 suggestion chips on empty state, all copy via `useTranslations().studentTeliChat` (`headerTitle`, `introHey`, `suggestion1-4`, `tapToHear`, `rateLimitNotice`, `inputPlaceholder`, `sendButton`, `footerDisclaimer`, `teliThinking`, etc.). Hardcoded hex colors via `@/lib/design/tokens` (`colors`, `gradients`, `radius`, `typography`).

---

## 5. Free-chat system prompt (E) + Light Check-In priming — VERBATIM

`/api/attempts/teli-chat/route.ts`. Tier-capped (`USAGE_CAPS.teli_chat`: Essentials 20/day, Pro 50/day, Enterprise unlimited; via `checkUsageCap`/`logCappedUsage`). Students-only (`profile.role !== 'student'` → 403). Pulls `student_model` (`mastery_band, learning_style, strength_topics, struggle_topics`), recent `assignments.content.title` (last 3), grade level via `enrollments→classes.grade_level`.

```
You are Teli, a friendly AI tutor for a K-12 student.
Student grade: ${gradeLevel}.
${recentTopics ? `Recent topics studied: ${recentTopics}.` : ''}
${strengths ? `Strengths: ...` : ''}
${struggles ? `Areas to work on: ...` : ''}

Rules:
- Be warm, encouraging, and age-appropriate
- Give Socratic guidance — ask questions that help them think
- Never just give answers to homework or quiz questions
- Keep responses concise — 2-4 sentences maximum
- If asked something outside school subjects, gently redirect
- You can help with: understanding concepts, revision, explaining things differently, study tips
- Use simple language and relatable examples
- If the student seems frustrated, acknowledge their feelings before helping${checkinPriming}
```
Messages = `[system (withLocaleInstruction), ...conversation_history.slice(-10), {user: message}]`.

**Light Check-In priming:** reads open `alerts` where `student_id=user, status='open', trigger_reason='teacher_light_checkin'` (limit 5). If any, appends `checkinPriming` block (CONTEXT — YOUR TEACHER JUST CHECKED IN: open supportively, don't lead with "your teacher sent me", offer to walk through recent work, ask ONE gentle question). After a successful response, auto-resolves those alerts (`status:'resolved', resolved_at, resolution_note:'Student engaged with Teli after teacher check-in request'`). Daily-cap 429 returns `{ error, response, limited:true, used, limit, resetAt }`.

---

## 6. The in-assignment Teli panel (the actual player UX) — `student/homework/page.tsx`

The player renders its **own inline `#teli-panel`** (lines ~1444–1479), it does NOT use `TeliChat.tsx`.

- **Tutor state (lines 41–125):** `sessionId`, `tutorMessages: Record<number, TutorMessage[]>` (keyed by task index), `currentMessage`, `tutorLoading`, `teliState: TeliState`, `hintsRemaining` (init **3**), `scaffoldDepth` (init 0), `teliFloatingOpen`, `adaptedTasks`, `adaptingTask`. Refs: `taskHelpRequests: Record<number,number>` (per-task hint counter), `lastHintTime`, `taskStartTime`, `taskSignals`, `chatEndRef`.
- **`TutorMessage` type** (`components/student/homework/types.ts:38`): `{ role: 'user'|'assistant'; content: string; hint_type?: string; input_method?: 'text'|'voice' }`.
- **Send flow `handleAskTutor()` (line 672):**
  - Client hard-cap: `if (hintsRemaining <= 0) return;` (guards a reported server off-by-one — comment says server is authoritative for counting).
  - `taskHelpRequests.current[idx] += 1`; `trackEvent('hint_request', {taskIndex, taskDescription})`.
  - Calls `sendTutorMessage(sessionId, currentMessage, idx, task.description, /*isHelpRequest*/ true, history)` — **every player ask is sent as a help request** (`is_help_request=true`), so every message advances the ladder.
  - On return: append assistant `{content, hint_type: data.hint_type ?? undefined}`, `setScaffoldDepth(data.scaffold_depth||0)`, `setHintsRemaining(data.hints_remaining||0)`, `teliSpeak(teliResponse, onSpeaking, onIdle)`.
  - **Auto-adapt trigger:** `if ((taskHelpRequests.current[idx]||0) >= 2 && !adaptedTasks[idx]) adaptTask(idx)` → `POST /api/attempts/homework-adapt` with `{task_description, task_type, mastery_band, learning_style, hint_count, assignment_title}`.
- **Voice flow `handleVoiceTranscript()` (line 648):** same as above but `input_method:'voice'`, also `hintsRemaining<=0` guard, `trackEvent('hint_request', {..., input_method:'voice'})`.
- **`handleTaskStart(idx)` (line 615):** resets `scaffoldDepth=0, hintsRemaining=3, imageMode=null` (the 3-hint budget is **per task**).
- **Hint-label render (line 1463):** `HINT_LABEL[msg.hint_type]` from `buildHintLabel(t)` (`components/student/homework/helpers.ts`): `{ nudge: t.studentPages.hintNudge, cue: t.studentPages.hintCue, step: t.studentPages.hintWalkthrough, answer_blocked: t.studentPages.hintsExhausted }`. Also `HINT_COLOR = { nudge:'#eef2ff', cue:'#fffbeb', step:'#faf5ff', answer_blocked:'#fef2f2' }`.
- **Hints-remaining pill (line 1449):** shows `${hintsRemaining} hints remaining` or `noHintsLeft` (red). When exhausted + messages present, a `teliExhaustedHints` notice (line 1470).
- **Intro bubble:** `TELI_INTRO_MESSAGE` = `"Hi! I'm Teli, your learning buddy 👋 I'm here to help you think through this — just ask me anything!"` (`lib/teli/prompts.ts`).
- **Per-hint feedback:** `<FeedbackThumbs event="teli_hint_rated" homeworkId={assignment.id} hintIndex={i} compact />` on each assistant hint bubble.
- **Avatar/animation:** `AnimatedTeliAvatar` (= `components/teli/TeliAvatar`) with `state={teliState}` (`'idle'|'speaking'|'thinking'|'celebrating'|'listening'` from `getTeliStateFromContext`). `TeliVoiceButton` size 42.
- **Session creation:** on load (lines 281–298), looks for an active `tutor_sessions` row for the assignment+student; if none, inserts one client-side via supabase with `{assignment_id, student_id, class_id, lesson_id, mastery_band, learning_style, status:'active', started_at, scaffold_depth:0, help_request_count:0, hint_count:0}`. (Routes `/api/tutor-start` do the same server-side for path C — also `audit_logs` `tutor_session_start`.)

---

## 7. Persistence — tables & columns

### `tutor_sessions`
- **Base migration `000_full_schema.sql:400`** defines: `id, student_id (FK users), assignment_id, quiz_attempt_id, class_id, session_id text, started_at, ended_at, total_messages int, help_requests int, scaffold_depth int, session_insight jsonb`.
- **RUNTIME columns the code reads/writes that are NOT in 000** (live-DB drift — added by later migrations not present as ALTERs in the repo, or seeded into the live DB): `status` (`'active'|'completed'`), `hint_count`, `help_request_count`, `last_activity_at`, `completed_at`, `lesson_id`, `mastery_band`, `learning_style`, `tasks_completed`, `tasks_total`, `scaffold_dependency_score`. **V2 must define these explicitly** — the player insert + every update touches them. (`submitHomework` sets `status:'completed', completed_at, tasks_completed, tasks_total, scaffold_dependency_score = min(1, totalHelpRequests/(totalTasks*3))`.)

### `tutor_messages`
- **Base `000_full_schema.sql:416`:** `id, session_id (FK tutor_sessions ON DELETE CASCADE), role text CHECK(role IN ('student','assistant','system')), content, created_at`.
- **RUNTIME columns the code writes (drift):** `student_id`, `task_index`, `is_help_request bool`, `hint_type`, `scaffold_level`, `message_index` (player action only), `response_time_ms` (route C only), `prompt_tokens`/`completion_tokens` (route C only). **Note role mismatch:** the code inserts `role:'user'` but the 000 CHECK only allows `'student'|'assistant'|'system'` — the live DB constraint must differ (drift). Player action inserts BOTH user+assistant rows in one `.insert([...])` array.
- Writes are **non-blocking / fire-and-forget** in routes A and B (supabase-js doesn't throw; failed inserts logged, response still returned — "Bug #25"). Route C uses awaited inserts and `.select().single()`.

### `signal_events` (route C + player `submitHomework` only — NOT the player tutor turn)
- Route C per tutor turn: `{ user_id, session_id, class_id, signal_family:'behavioral', event_type:'tutor_interaction', payload:{task_index, is_help_request, hint_type, scaffold_level, response_time_ms, message_length}, source_module:'tutor', schema_version:'v1' }`.
- `submitHomework` per task: `event_type:'homework_task'`, `source_module:'homework'`, payload = the `TaskSignal`.

---

## 8. How hint count feeds grading — VERBATIM

`app/api/attempts/homework-submit/route.ts` (lines 424–459):
```ts
const { data: hintSession } = await admin.from('tutor_sessions')
  .select('hint_count').eq('student_id', user.id).eq('assignment_id', assignment_id)
  .order('created_at', { ascending: false }).limit(1).maybeSingle();
const teliHintCount = hintSession?.hint_count ?? 0;

const effortLabel = computeEffortLabel({ score: grading.grade, teliHintCount });

// homework_attempts UPDATE sets:  teli_hint_count: teliHintCount, effort_label: effortLabel, ...
```
- `homework_attempts.teli_hint_count int DEFAULT 0` (`000:225`). (Note: that column lives on `homework_attempts`; the same table also has `score_pct`, `canvas_data`, `responses`, `ai_feedback`, `teacher_score`, `submitted_on_time`, plus runtime-added `grade`, `teacher_notes`, `graded_at`, `hours_to_submit`, `effort_label`, `allow_redo`.)
- **`computeEffortLabel`** (`lib/signals/computeEffortLabel.ts`): single classification rule. Thresholds `SUCCESS_THRESHOLD = 75`, `EFFORT_THRESHOLD = 2`. `isSuccess = score>=75`, `isEffortful = hints>=2`. Returns one of `effortful_success | struggling_trying | independent_success | independent_struggle`; returns `null` if score null. (Comment flags hint-count as a "noisy proxy for effort".)

---

## 9. Anti-cheat / "don't give the answer" guardrails — VERBATIM

Layered, repeated across prompts:
- `tutorSystemPrompt`: "Your job is to guide, hint, and ask questions — **NEVER give the direct answer**"; numbered rules `1. NEVER state the direct answer`, `5. If asked "just tell me the answer" — redirect kindly using the Inteliflow strategy approach`.
- `TELI_SYSTEM_PROMPT`: "NEVER reveal answers directly — always guide with questions"; the i-Ready "one-way-only teaching is i-Ready's failure mode; you are the opposite of that" rule.
- Every per-level HINT string ends with "Do NOT give … the answer" — even `answer_blocked` ("No direct answer" / "summarize the key concept … for next time").
- Free-chat (E): "Give Socratic guidance"; "Never just give answers to homework or quiz questions"; "If asked something outside school subjects, gently redirect".
- **Hard cap:** 3 hints/task client-side (`hintsRemaining<=0` blocks both text & voice ask). After the ladder is exhausted (`answer_blocked`) Teli still refuses the answer and summarizes the concept.
- `diagramContext` honesty guard: if a diagram is shown and the student says it's wrong, "help them understand the concept using words instead. Do not pretend the diagram is correct".

---

## 10. Voice / TTS contract (reused by player + free-chat)

- **TTS** `teliSpeak(text, onStart?, onEnd?)` (`lib/teli/identity.ts`): respects `localStorage 'teli_muted'`, single shared `_teliAudio` element, `POST /api/attempts/tts` body `{ text: text.slice(0,500) }`, plays returned `audio/mpeg` blob. Route `tts/route.ts`: `openai.audio.speech.create({ model:'tts-1', voice:'nova', input: text.slice(0,4096), speed: 0.9 })`; tier-capped `USAGE_CAPS.tts_characters`; returns mpeg with `Cache-Control: public, max-age=3600`.
- **STT** `TeliVoiceButton` → `POST /api/attempts/teli-voice` (multipart `audio` File). Route: `openai.audio.transcriptions.create({ file, model:'whisper-1', language: getBrand().locale })`; tier-capped `USAGE_CAPS.whisper_seconds` (monthly, est. `size/8000` sec); rejects files `<1000` bytes (`too_short`); returns `{ transcript, duration_ms }` or `{transcript:'', error}`. Logs to `system_events` `event_type:'teli_voice'`.
- `TELI_VOICE_RESPONSES = { too_short, transcription_failed, mic_denied }` (`lib/teli/identity.ts`).
- `TeliState` = `'idle'|'speaking'|'thinking'|'celebrating'|'listening'`; `getTeliStateFromContext(isLoading, isSpeaking, isListening, studentDidWell)`.

---

## 11. Endpoint/payload quick reference (verbatim names)

- Player tutor turn (server action): `sendTutorMessage(sessionId, message, taskIndex, taskDescription, isHelpRequest, messageHistory)` → returns `{ response, hint_type, scaffold_depth, hints_remaining, help_request_count }` (or `{error}`).
- `POST /api/attempts/tutor` body: `{ session_id, message, task_index, task_description, is_help_request, message_history }` → `{ response, hint_type, scaffold_depth, hints_remaining, help_request_count }`.
- `POST /api/tutor-message` — same body/return as above (+ writes signal_events). Requires `session.status==='active'` (400 otherwise).
- `POST /api/tutor-start` body: `{ assignment_id }` → `{ session_id, resumed: boolean }`.
- `POST /api/attempts/teli-chat` body: `{ message, conversation_history }` → `{ response }` | `{error, response, limited, used, limit, resetAt}` (429).
- `POST /api/attempts/homework-adapt` body: `{ task_description, task_type, mastery_band, learning_style, hint_count, assignment_title }`.
- `POST /api/attempts/tts` body: `{ text }` → `audio/mpeg`.
- `POST /api/attempts/teli-voice` multipart `audio` → `{ transcript, duration_ms }`.
