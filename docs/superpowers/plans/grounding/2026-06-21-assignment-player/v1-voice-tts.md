# V1 grounding — Voice / TTS / Transcription for the Assignment Player

Verbatim current-code facts from V1 (`C:/users/inteliflow/core`). Captured for the V2 Epic 2
(non-SPARK Assignment Player) port. **No critique, no proposals — what exists today.**

## Provider summary (the one-line answer)

- **Provider/SDK:** **OpenAI**, the official `openai` npm SDK. No ElevenLabs, no Azure, no
  third-party voice provider anywhere in these routes. Every route constructs
  `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`.
- **TTS (text → speech):** OpenAI **`tts-1`** model, voice **`nova`**, speed **`0.9`**, output **MP3** (`audio/mpeg`).
- **Transcription (speech → text):** OpenAI **`whisper-1`** model, with `language` set to the brand locale (`'en'` for CORE).
- **There is NO top-level `app/api/tts` or `app/api/transcribe`.** A documented Turbopack bug
  ("new TOP-LEVEL `app/api/*` route folders 404") forces every API route to nest under an
  existing path. All four voice routes live under **`app/api/attempts/...`**.

---

## 1. Text-to-Speech — `POST /api/attempts/tts`

**File:** `C:/users/inteliflow/core/app/api/attempts/tts/route.ts` (58 lines)

### Auth + request
- Auth: `createServerSupabaseClient()` → `supabase.auth.getUser()`; 401 if no user. Any authenticated user.
- **Request body (JSON):** `{ text }`. 400 `{ error: 'No text provided' }` if `text` falsy.
- Reads `users.school_id` via `createAdminSupabaseClient()` (`.from('users').select('school_id').eq('id', user.id).maybeSingle()`).

### Usage cap (BEFORE the OpenAI call)
- `inputChars = Math.min(text.length, 4096)` (mirrors the actual API input that gets sent).
- If `schoolId` present: `checkUsageCap(schoolId, 'tts_characters', inputChars)` (from `@/lib/licensing/usageCaps`).
- If `!cap.allowed`: returns **HTTP 429** with
  `{ error: 'cap_reached', message: 'Monthly text-to-speech limit reached (used/limit characters). Resets YYYY-MM-DD.', used, limit, resetAt }`.

### The OpenAI call (exact)
```ts
const mp3 = await openai.audio.speech.create({
  model: 'tts-1',
  voice: 'nova',
  input: text.slice(0, 4096), // TTS limit
  speed: 0.9,
})
const buffer = Buffer.from(await mp3.arrayBuffer())
```
- **Model:** `tts-1`. **Voice:** `nova`. **Speed:** `0.9`. **Input truncated to 4096 chars.**

### Usage logging (AFTER, non-blocking)
- `void logCappedUsage(schoolId, user.id, 'tts_characters', inputChars)` (fire-and-forget).

### Response (exact)
- Returns the **raw MP3 buffer** as the `NextResponse` body, headers:
  - `Content-Type: 'audio/mpeg'`
  - `Content-Length: buffer.length.toString()`
  - `Cache-Control: 'public, max-age=3600'`
- Error path: `console.error('TTS error:', err)` → 500 `{ error: 'TTS generation failed' }`.

---

## 2. Whisper transcription (Teli voice input) — `POST /api/attempts/teli-voice`

**File:** `C:/users/inteliflow/core/app/api/attempts/teli-voice/route.ts` (105 lines)
Header comment: "POST — Whisper transcription for Teli voice input. Tier-capped: USAGE_CAPS.whisper_seconds".

### Auth + request
- Auth: `createServerSupabaseClient()` → `getUser()`; 401 if missing.
- Reads `users.school_id` (this time via the **server** client, not admin).
- **Request is `multipart/form-data`** via `req.formData()`. Reads field **`audio`** as a `File`.
- Guard: if `!audioFile || audioFile.size < 1000` → logs `'too_short'` and returns `{ transcript: '', error: 'too_short' }`.

### Usage cap (BEFORE the Whisper call)
- If `schoolId`: `checkUsageCap(schoolId, 'whisper_seconds')` → on `!cap.allowed`, **HTTP 429**
  `{ transcript: '', error: 'cap_reached', message: 'Monthly voice transcription limit reached (used/limit seconds). Resets YYYY-MM-DD.', used, limit, resetAt }`.

### The OpenAI call (exact)
```ts
const transcription = await openai.audio.transcriptions.create({
  file: audioFile,
  model: 'whisper-1',
  language: getBrand().locale, // 'en' (CORE) | 'pt' (EduFlux)
})
const transcript = transcription.text?.trim() || ''
```
- **Model:** `whisper-1`. **`language`** = `getBrand().locale` (from `@/lib/brand`; `'en'` for CORE, `'pt'` for EduFlux).

### Usage logging
- After success: `logEvent(studentId, schoolId, durationMs, whisperMs, null)`.
- `estimatedSeconds = Math.max(1, Math.round(audioFile.size / 8000))` — Whisper-1 returns no
  duration, so seconds are **estimated from byte size at a conservative ~8 KB/sec** (comment notes
  this under-counts ~25%, so the cap is "generous, not punitive").
- `void logCappedUsage(schoolId, studentId, 'whisper_seconds', estimatedSeconds)`.

### Response (exact)
- Success: `{ transcript, duration_ms: durationMs }`.
- Failure: `console.error('Teli voice error:', err)` → `{ transcript: '', error: 'transcription_failed' }` (note: 200-status JSON, NOT a 4xx/5xx).

### Analytics side-effect — `logEvent`
- Inserts into **`system_events`** via admin client:
  - `event_type: 'teli_voice'`, `status: 'success' | 'error'`,
  - `metadata: { duration_ms, whisper_ms, cost_cents: Math.round(durationMs / 1000 * 0.6), error, school_id, student_id }`.
  - Wrapped in try/catch — **non-blocking**.

---

## 3. Whisper transcription (generic) — `POST /api/attempts/transcribe`

**File:** `C:/users/inteliflow/core/app/api/attempts/transcribe/route.ts` (109 lines)
Header comment: "generic Whisper transcription (audio → text)... Decoupled twin of
`/api/attempts/teli-voice`: same Whisper call + brand-locale handling + tier cap, but a generic
event label so non-Teli dictation surfaces (e.g. the AI lesson generator's 'speak your idea' input)
are attributed correctly instead of polluting teli_voice analytics. Any authenticated user may call it."

- **Byte-for-byte the same logic** as `teli-voice` (auth, form field `audio`, `< 1000` byte
  guard, `whisper_seconds` cap with identical 429 shape, `whisper-1` + `getBrand().locale`, the
  `audio.size / 8000` second estimate, `{ transcript, duration_ms }` / `{ transcript: '', error: 'transcription_failed' }` responses).
- **Only differences:**
  - Variable named `userId` instead of `studentId`.
  - Reads `users.school_id` via the **server** client.
  - `logEvent` inserts `event_type: 'voice_transcribe'` (vs `'teli_voice'`) into `system_events`,
    metadata key `user_id` (vs `student_id`); same `cost_cents` formula `Math.round(durationMs / 1000 * 0.6)`.
- **Has a unit test:** `__tests__/api/transcribe.test.ts` (`POST` imported from the route;
  posts a `FormData` to `http://localhost:3000/api/attempts/transcribe`).

---

## 4. Voice PROFILE override (NOT a voice ID) — `POST /api/attempts/voice-profile`

**File:** `C:/users/inteliflow/core/app/api/attempts/voice-profile/route.ts` (71 lines)
Header comment: "V6 Prompt 6 Part A — student-controlled voice profile override."

> ⚠️ Naming caveat: this is **not** a TTS voice selector. "Voice profile" here = Teli's
> *coaching/communication persona*, consumed by `buildTeliSystemPrompt` (the LLM system prompt),
> NOT by the OpenAI TTS voice (which is always `nova`).

- Auth: `createServerSupabaseClient()` → `getUser()`; 401 if missing.
- **Request body (JSON):** `{ voice_profile }`. Validated against
  `VALID_PROFILES = ['warmth_seeking', 'dry_respectful', 'visual_first', 'verbal_first']`.
  Invalid → 400 `{ error: 'voice_profile required; one of: warmth_seeking, dry_respectful, visual_first, verbal_first' }`.
- Writes to table **`student_model`** (admin client), keyed on `student_id = user.id`:
  - `voice_profile` = the chosen value
  - `voice_profile_user_override = true`
  - `voice_profile_history` = appends `{ from, to, changed_at, by: 'student_override' }` (audit array)
  - `voice_profile_last_confirmed_at = now`
- Response: `{ ok: true, voice_profile }`. Error → 500 `{ error: msg }`.
- **Consumer:** `components/student/StudentProgressV2.tsx` `changeVoice(profile)` (lines ~376-391)
  POSTs JSON, and on `res.ok` updates local `selfKnowledge` state. Options labels come from
  i18n `t.selfKnowledge.voice*` (Warmth-Seeking / Dry-Respectful / Visual-First / Verbal-First).

---

## How the player CONSUMES these routes (client side)

### TTS playback — two consumers

**(a) `lib/teli/identity.ts` → `teliSpeak(text, onStart?, onEnd?)`** (the shared helper, lines ~85-144)
- **Mute gate:** reads `localStorage.getItem('teli_muted') === 'true'` → if muted, returns immediately (no fetch).
- Stops any in-flight Teli audio (module-level singleton `_teliAudio: HTMLAudioElement | null`).
- `fetch('/api/attempts/tts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: text.slice(0, 500) }) })`
  — note the **500-char client truncation** here (separate from the route's 4096 cap).
- `.blob()` → `URL.createObjectURL(blob)` → `new Audio(url)`; wires `onplay`→`onStart`, `onended`/`onerror`→revoke URL + clear singleton + `onEnd`, then `audio.play()`.
- **Fails silently** on any error ("no audio is fine"). Companion `teliStopSpeaking()` pauses + clears the singleton.

**(b) Homework player `app/(dashboard)/student/homework/page.tsx` → `generateAudio(text)`** (lines ~363-371)
- `fetch('/api/attempts/tts', ...)` with `{ text }` (no 500 truncation here) → `setAudioUrl(URL.createObjectURL(await res.blob()))`; toggles `audioLoading`.
- Auto-triggered on load: `const txt = a.content.audio_script || a.content.reading_passage; if (txt) generateAudio(txt)` (line ~353-354).
- **Rendered via a real `<audio>` element** with a ref:
  `<audio ref={audioRef} src={audioUrl||undefined} onPlay=... onPause=... onEnded=... />` (line 999).
- A pill **Listen / Pause** button (top-right of the Reading Passage card) calls `audioRef.current.play()/pause()`.
  States: `audioUrl` present → Listen/Pause button; `audioLoading` → "Generating audio…" text;
  else → a **"Generate audio"** button that re-calls `generateAudio`. Emits analytics
  `trackEvent('tts_play'|'tts_replay', { section:'passage', playCount })` via a `ttsPlayCount` ref.
- A second compact audio player appears in the vocab/concepts section (lines ~1148-1155).
- Teli chat bubbles: clicking an assistant message calls `teliSpeak(msg.content)` (line ~1461);
  Teli tutor replies auto-speak via `teliSpeak(teliResponse, () => setTeliState('speaking'), () => setTeliState('idle'))` (lines 665, 695).

### Mic / Whisper input — `components/teli/TeliVoiceButton.tsx` (229 lines)
- Props: `onTranscript(text)`, `onStateChange(state: TeliState)`, `disabled?`, `size? = 48`.
- `RecordingState = 'idle' | 'recording' | 'processing'`. Constants: `MAX_DURATION_MS = 30_000`, `MIN_DURATION_MS = 500`.
- Permission: on mount queries `navigator.permissions.query({ name:'microphone' })`; shows a ✅/❌/❓ badge. Returns `null` if `getUserMedia` unsupported.
- Recording: `navigator.mediaDevices.getUserMedia({ audio: true })` → `MediaRecorder`. **MIME negotiation:** `audio/webm` → `audio/mp4` → `''` (`MediaRecorder.isTypeSupported`). `recorder.start(100)`. Auto-stops at 30 s.
- On stop: builds `new Blob(audioChunks, { type: mimeType || 'audio/webm' })`, appends to `FormData` as field **`audio`** with filename `voice.mp4` or `voice.webm`, then
  `fetch('/api/attempts/teli-voice', { method:'POST', body: formData })`.
- Reads `data.error` (`'too_short'`, other) and `data.transcript`; on transcript calls `onTranscript(text)`. Tooltip strings from i18n `teliVoice.*`.
- Visuals: ripple rings while recording, `TeliWaveform` (live `MediaStream` waveform), spinner while processing, color states (recording `#ef4444`, processing `#f59e0b`, idle indigo gradient).
- **In the homework player:** `<TeliVoiceButton size={48} onTranscript={...append to taskResponses...} onStateChange={setTeliState} disabled={tutorLoading} />` for task answers (line ~1262) and `size={42}` in the Teli chat input (line ~1477).

### Other Whisper consumer (for parity reference)
- `components/teacher/LessonVoiceInput.tsx` (line ~100) posts the same `FormData{audio}` to **`/api/attempts/transcribe`** (the generic twin) — teacher "speak your idea" dictation in the AI lesson generator.

---

## Usage caps — exact values (`lib/licensing/usageCaps.ts`)

`CappedFeature` includes `'whisper_seconds'` (per school per month, seconds of audio) and
`'tts_characters'` (per school per month, characters of input). `Tier` = essentials | professional | enterprise.

| Cap | essentials | professional | enterprise | period |
|---|---|---|---|---|
| `whisper_seconds` | `12_000` (200 min) | `60_000` (1000 min) | `null` (unlimited) | `month` |
| `tts_characters` | `100_000` | `500_000` | `null` (unlimited) | `month` |

- `CAP_EVENT_SOURCE`: `whisper_seconds → 'whisper'`, `tts_characters → 'tts'`.
- Helpers used by routes: `checkUsageCap(schoolId, feature, amount?)` returns `{ allowed, used, limit, resetAt }`; `logCappedUsage(schoolId, userId, feature, amount)`.

---

## Is voice CORE or OPTIONAL to the experience?

**Optional / supplemental — the player works fully without it.** Evidence:
- `teliSpeak` is gated by a `teli_muted` localStorage flag and **fails silently** ("no audio is fine; fail silently").
- TTS errors in the homework player are caught with `console.error` and just leave `audioUrl` null; the passage is always shown as text (`dangerouslySetInnerHTML={renderPassage(...)}`).
- `TeliVoiceButton` **returns `null` entirely** when `getUserMedia` is unsupported, and degrades to a tooltip when mic is denied — the student can always type into the same field (`onTranscript` appends to the existing text response).
- Tier caps return graceful 429/`cap_reached` JSON; the surfaces continue without audio.
- TTS is an enhancement on the Reading Passage and Teli replies; transcription is an alternative input to typing. Neither is on the critical path to reading/answering/submitting an assignment.

---

## V2-port-relevant identifiers (quick index)
- Endpoints (all under `attempts/` due to Turbopack 404): `POST /api/attempts/tts`, `POST /api/attempts/teli-voice`, `POST /api/attempts/transcribe`, `POST /api/attempts/voice-profile`.
- OpenAI: `openai.audio.speech.create({ model:'tts-1', voice:'nova', input, speed:0.9 })` → MP3; `openai.audio.transcriptions.create({ file, model:'whisper-1', language })` → `.text`.
- Env: `OPENAI_API_KEY`. Brand locale: `getBrand().locale` from `@/lib/brand`.
- TTS request field: `text` (JSON). Transcribe/teli-voice request field: `audio` (multipart File).
- TTS response: raw MP3 body, `Content-Type: audio/mpeg`. Transcribe response: `{ transcript, duration_ms }`.
- Client helpers: `teliSpeak` / `teliStopSpeaking` (`lib/teli/identity.ts`), `TeliVoiceButton` (`components/teli/TeliVoiceButton.tsx`).
- Mute flag: `localStorage 'teli_muted' === 'true'`.
- Analytics table: `system_events` (`event_type: 'teli_voice' | 'voice_transcribe'`). Cap libs: `lib/licensing/usageCaps.ts`.
- `voice_profile` values: `warmth_seeking | dry_respectful | visual_first | verbal_first` (Teli persona, NOT TTS voice); table `student_model`.
