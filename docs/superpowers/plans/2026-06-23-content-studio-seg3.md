# Content Studio Segment 3 — Voice (dictation + read-aloud) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let users **speak instead of type** (a mic that transcribes via OpenAI Whisper into the teacher's "describe a lesson" box and the student's answer box) and **listen instead of read** (a read-aloud button that plays an assignment passage via OpenAI TTS, using the already-generated `audio_script`), lighting up the dead `ttsPlayCount` engagement signal.

**Architecture:** Two thin OpenAI wrappers (`resilientAudioTranscription`, `resilientTextToSpeech`) mirror the existing `resilientChatCompletion` retry/`LlmExhaustedError` pattern on the already-exported raw client. Two stateless routes (`POST /api/attempts/transcribe` → text, `POST /api/attempts/tts` → audio bytes) wrap them with a `getUser` gate (any authenticated user; the audio is the caller's own, no object access). Two reusable client components — `MicButton` (MediaRecorder → transcribe → `onTranscript`) and `ReadAloudButton` (TTS → `<audio>` playback) — are wired into the three surfaces. **No DB, no storage, no migration** — dictated text flows into fields that already persist; read-aloud reads existing text and streams audio (never stored).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 (token-only), native MediaRecorder + HTMLAudioElement (no new dependency), OpenAI SDK (`audio.transcriptions` / `audio.speech`), Vitest 4 (+ jsdom/RTL).

## Global Constraints

- **Auth:** `await createServerSupabaseClient()` → `auth.getUser()` (401). Both routes need ONLY an authenticated user — they are stateless (transcribe the caller's own audio / read text aloud), so NO role/IDOR guard. Reuse `respondEngineError` (`LlmExhaustedError` → 503) on failure; never 200 on a failed transcription.
- **Models:** transcription = `OPENAI_TRANSCRIBE_MODEL` (default `whisper-1`); TTS = `OPENAI_TTS_MODEL` (default `tts-1`). Add both to `src/lib/ai/models.ts` + the `MODELS` object. Do NOT touch the calibration-locked grading/gen models.
- **Engine purity:** the two wrappers live in `src/lib/ai/openai.ts` (already import-safe — no `next/*`/Supabase). They throw `LlmExhaustedError('openai', cause)` on terminal failure, mirroring `resilientChatCompletion` exactly (same retry/backoff/timeout shape).
- **Per-request caps (no quota system yet):** transcribe audio ≤ 25 MB (Whisper limit) + a small floor (`too_short`); TTS text ≤ 4096 chars (TTS limit). A monthly usage-quota (V1's `whisper_seconds`/`tts_characters`) is a **documented deferral** — V2 has no usage-caps table.
- **a11y + tokens:** Tailwind v4 token classes only (no hardcoded hex / arbitrary `[var(--..)]`). The mic/read-aloud buttons have clear accessible names that reflect state (`aria-pressed`, "Stop" while active); `MicButton` returns `null` when `getUserMedia`/`MediaRecorder` is unavailable (graceful degradation — typing still works); recording-pulse uses `motion-safe:` (reduced-motion respected); visible focus rings. Deep-ink `text-fg`.
- **Dictation appends** (does not replace) — like V1: the transcript is appended to whatever's typed.
- **"Assignments", never "Homework".** All new user-facing strings are DRAFTs → `STRINGS-FOR-BARB.md §Content Studio — Seg 3`.
- **TDD:** test first. Component tests start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`. Engine tests mock the OpenAI client; route tests mock `@/lib/supabase/server` + the engine fn. jsdom lacks `MediaRecorder`/`getUserMedia`/`HTMLMediaElement.play`/`URL.createObjectURL` — the components null-guard them and the tests stub them.
- **Gates:** `npx tsc --noEmit` 0 · `npm test` green · `npm run build` 0 (a11y + tokens).

---

## File Structure

**New files**
- `src/app/api/attempts/transcribe/route.ts` (+ test) — Whisper dictation endpoint.
- `src/app/api/attempts/tts/route.ts` (+ test) — TTS read-aloud endpoint.
- `src/app/(student)/student/assignments/[id]/play/_components/MicButton.tsx` (+ test) — record→transcribe→onTranscript. (Lives in the player components dir but is imported by the teacher Generate tab too — a shared voice control.)
- `src/app/(student)/student/assignments/[id]/play/_components/ReadAloudButton.tsx` (+ test) — TTS playback.

**Modified files**
- `src/lib/ai/models.ts` — add `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TTS_MODEL`.
- `src/lib/ai/openai.ts` — add `resilientAudioTranscription`, `resilientTextToSpeech` (+ `toFile` import).
- `src/app/(teacher)/upload/_components/GenerateLessonStudio.tsx` — mic next to the description.
- `src/app/(student)/student/assignments/[id]/play/_components/TaskCard.tsx` — mic under the answer textarea.
- `src/app/(student)/student/assignments/[id]/play/_components/ReadPhase.tsx` — read-aloud button on the passage (+ an `onTtsPlay` prop).
- `src/app/(student)/student/assignments/[id]/play/_components/AssignmentPlayer.tsx` — `sessTtsPlayCount` ref → `ttsPlayCount` (replace the hardcoded 0); pass `onTtsPlay` to ReadPhase.
- `STRINGS-FOR-BARB.md` — §Content Studio — Seg 3.

**Dependency waves**
- **Wave A:** Task 1 (models + engine wrappers).
- **Wave B (after A; parallel):** Task 2 (transcribe route), Task 3 (tts route).
- **Wave C (parallel):** Task 4 (MicButton), Task 5 (ReadAloudButton).
- **Wave D (after C):** Task 6 (Generate tab mic), Task 7 (TaskCard mic), Task 8 (ReadPhase + player read-aloud).
- **Wave E:** Task 9 (strings + gates). Playwright preview before merge.

---

### Task 1: Model consts + `resilientAudioTranscription` / `resilientTextToSpeech`

**Files:** Modify `src/lib/ai/models.ts`, `src/lib/ai/openai.ts`; Test `src/lib/ai/__tests__/audio.test.ts`.

**Interfaces:**
- Produces: `OPENAI_TRANSCRIBE_MODEL` (`'whisper-1'`), `OPENAI_TTS_MODEL` (`'tts-1'`); `resilientAudioTranscription(audio: { buffer: Buffer; filename: string }, options?): Promise<string>` (the transcript); `resilientTextToSpeech(text: string, options?): Promise<Buffer>` (MP3 bytes). Both throw `LlmExhaustedError('openai', cause)` on terminal failure. Consumed by Tasks 2 + 3.

- [ ] **Step 1: Add the model consts** to `src/lib/ai/models.ts` (after `OPENAI_VOICE_MODEL`, line ~39):

```ts
/** OpenAI speech-to-text for voice dictation. The Whisper API model is fixed to whisper-1; env-overridable. */
export const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

/** OpenAI text-to-speech for read-aloud (plays an assignment's audio_script). Env-overridable. */
export const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'tts-1';
```

And add to the `MODELS` object: `transcribe: OPENAI_TRANSCRIBE_MODEL,` and `tts: OPENAI_TTS_MODEL,`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/ai/__tests__/audio.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';

const transcriptionsCreate = vi.fn();
const speechCreate = vi.fn();
vi.mock('openai', () => {
  class OpenAI { audio = { transcriptions: { create: transcriptionsCreate }, speech: { create: speechCreate } }; }
  return { default: OpenAI, toFile: async (b: unknown, name: string) => ({ name, b }) };
});

describe('resilientAudioTranscription', () => {
  beforeEach(() => { transcriptionsCreate.mockReset(); speechCreate.mockReset(); });

  it('returns the transcript string (response_format text → string)', async () => {
    transcriptionsCreate.mockResolvedValue('Hello there.');
    const { resilientAudioTranscription } = await import('@/lib/ai/openai');
    const out = await resilientAudioTranscription({ buffer: Buffer.from('x'), filename: 'audio.webm' });
    expect(out).toBe('Hello there.');
    expect(transcriptionsCreate).toHaveBeenCalledOnce();
  });

  it('tolerates an object {text} result', async () => {
    transcriptionsCreate.mockResolvedValue({ text: 'From an object.' });
    const { resilientAudioTranscription } = await import('@/lib/ai/openai');
    expect(await resilientAudioTranscription({ buffer: Buffer.from('x'), filename: 'a.webm' })).toBe('From an object.');
  });

  it('throws LlmExhaustedError on a non-retryable (400) failure', async () => {
    transcriptionsCreate.mockRejectedValue({ status: 400, message: 'bad' });
    const { resilientAudioTranscription } = await import('@/lib/ai/openai');
    await expect(resilientAudioTranscription({ buffer: Buffer.from('x'), filename: 'a.webm' })).rejects.toBeInstanceOf(LlmExhaustedError);
  });
});

describe('resilientTextToSpeech', () => {
  beforeEach(() => { speechCreate.mockReset(); });
  it('returns a Buffer of the audio bytes', async () => {
    speechCreate.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    const { resilientTextToSpeech } = await import('@/lib/ai/openai');
    const out = await resilientTextToSpeech('Read this aloud.');
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(3);
    expect(speechCreate).toHaveBeenCalledOnce();
  });
  it('throws LlmExhaustedError on terminal failure', async () => {
    speechCreate.mockRejectedValue({ status: 500, message: 'down' });
    const { resilientTextToSpeech } = await import('@/lib/ai/openai');
    await expect(resilientTextToSpeech('x', { maxRetries: 0 })).rejects.toBeInstanceOf(LlmExhaustedError);
  });
});
```

- [ ] **Step 3: Run → FAIL** (functions not exported). `npx vitest run src/lib/ai/__tests__/audio.test.ts`

- [ ] **Step 4: Implement in `src/lib/ai/openai.ts`**

Change the OpenAI import (line 5) to also import `toFile`:

```ts
import OpenAI, { toFile } from 'openai';
```

Add `OPENAI_TRANSCRIBE_MODEL, OPENAI_TTS_MODEL` to the models import (line 6):

```ts
import { usesLegacyTokenParam, OPENAI_TRANSCRIBE_MODEL, OPENAI_TTS_MODEL } from '@/lib/ai/models';
```

Append the two wrappers (mirroring `resilientImageGeneration`'s retry shape):

```ts
/**
 * Resilient speech-to-text (Whisper). Retries on 429/5xx/timeout; throws LlmExhaustedError
 * when exhausted. Returns the transcript text (response_format 'text' yields a string).
 */
export async function resilientAudioTranscription(
  audio: { buffer: Buffer; filename: string },
  options: RetryOptions = {},
): Promise<string> {
  const { maxRetries = 2, initialDelayMs = 1000, maxDelayMs = 10000, timeoutMs = 60000 } = options;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const file = await toFile(audio.buffer, audio.filename);
      const result = await getOpenAI().audio.transcriptions.create(
        { file, model: OPENAI_TRANSCRIBE_MODEL, language: 'en', response_format: 'text' },
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      return typeof result === 'string' ? result : ((result as { text?: string }).text ?? '');
    } catch (error: unknown) {
      const err = error as { status?: number; response?: { status?: number }; message?: string };
      const status = err?.status || err?.response?.status;
      const isRetryable = !status || status === 429 || status >= 500;
      lastErr = error;
      if (!isRetryable || attempt === maxRetries) {
        console.error(`[OpenAI Audio] Transcription failed after ${attempt + 1} attempts:`, err?.message || error);
        throw new LlmExhaustedError('openai', lastErr);
      }
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new LlmExhaustedError('openai', lastErr);
}

/**
 * Resilient text-to-speech. Retries on 429/5xx/timeout; throws LlmExhaustedError when exhausted.
 * Returns MP3 bytes (audio/mpeg) as a Buffer.
 */
export async function resilientTextToSpeech(
  text: string,
  options: RetryOptions = {},
): Promise<Buffer> {
  const { maxRetries = 2, initialDelayMs = 1000, maxDelayMs = 10000, timeoutMs = 60000 } = options;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const result = await getOpenAI().audio.speech.create(
        { model: OPENAI_TTS_MODEL, voice: 'nova', input: text, speed: 0.95 },
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      return Buffer.from(await result.arrayBuffer());
    } catch (error: unknown) {
      const err = error as { status?: number; response?: { status?: number }; message?: string };
      const status = err?.status || err?.response?.status;
      const isRetryable = !status || status === 429 || status >= 500;
      lastErr = error;
      if (!isRetryable || attempt === maxRetries) {
        console.error(`[OpenAI TTS] Speech failed after ${attempt + 1} attempts:`, err?.message || error);
        throw new LlmExhaustedError('openai', lastErr);
      }
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new LlmExhaustedError('openai', lastErr);
}
```

- [ ] **Step 5: Run → PASS (5/5).** **Step 6: Commit** `feat(content-studio): OpenAI transcription + TTS wrappers + model consts`

---

### Task 2: `POST /api/attempts/transcribe` — Whisper dictation

**Files:** Create `src/app/api/attempts/transcribe/route.ts` (+ test).

**Interfaces:** Consumes `resilientAudioTranscription`. Multipart `file` (audio). `getUser` → 401; validate audio MIME + size (≤ 25 MB, ≥ 1 KB → else `too_short`); transcribe; return `{ transcript }`. `LlmExhaustedError` → `respondEngineError` (503). Consumed by `MicButton` (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/attempts/transcribe/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const transcribe = vi.fn();
vi.mock('@/lib/ai/openai', () => ({ resilientAudioTranscription: (...a: unknown[]) => transcribe(...a) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: { getUser } }) }));

function req(file: Blob | null) {
  const f = new FormData();
  if (file) f.append('file', file, 'a.webm');
  return new NextRequest('http://x/api/attempts/transcribe', { method: 'POST', body: f });
}
const audio = (bytes: number, type = 'audio/webm') => new Blob([new Uint8Array(bytes)], { type });

beforeEach(() => {
  getUser.mockReset(); transcribe.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  transcribe.mockResolvedValue('  Hello there.  ');
});

describe('POST /api/attempts/transcribe', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    expect((await POST(req(audio(2048)))).status).toBe(401);
  });
  it('400 with no file', async () => {
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    expect((await POST(req(null))).status).toBe(400);
  });
  it('415 on a non-audio file', async () => {
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    expect((await POST(req(audio(2048, 'application/pdf')))).status).toBe(415);
  });
  it('400 too_short on a tiny blob (no transcribe call)', async () => {
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    const res = await POST(req(audio(100)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('too_short');
    expect(transcribe).not.toHaveBeenCalled();
  });
  it('returns the trimmed transcript on success', async () => {
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    const res = await POST(req(audio(2048)));
    expect(res.status).toBe(200);
    expect((await res.json()).transcript).toBe('Hello there.');
  });
  it('503 when transcription exhausts the LLM', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    transcribe.mockRejectedValue(new LlmExhaustedError('openai'));
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    expect((await POST(req(audio(2048)))).status).toBe(503);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/app/api/attempts/transcribe/__tests__/route.test.ts`

- [ ] **Step 3: Write the route**

```ts
// src/app/api/attempts/transcribe/route.ts
// POST — transcribe a short voice recording to text (OpenAI Whisper). Stateless: any authenticated
// user may transcribe their OWN audio (no object access), so getUser is the only gate. Audio is
// transient — NOT stored. The transcript flows back to the caller, who appends it to a field.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resilientAudioTranscription } from '@/lib/ai/openai';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';

const MAX_BYTES = 25 * 1024 * 1024; // OpenAI Whisper hard limit
const MIN_BYTES = 1024;             // below this it is too short to be speech

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let form: FormData;
    try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
    const file = form.get('file');
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'Missing audio' }, { status: 400 });
    if (file.type && !file.type.startsWith('audio/')) return NextResponse.json({ error: 'Only audio is supported.' }, { status: 415 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That recording is too long.' }, { status: 413 });
    if (file.size < MIN_BYTES) return NextResponse.json({ error: 'too_short' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.type.includes('mp4') ? 'audio.mp4' : 'audio.webm';
    const transcript = await resilientAudioTranscription({ buffer, filename });
    return NextResponse.json({ transcript: transcript.trim() });
  } catch (err) {
    console.error('[attempts/transcribe] error:', err);
    return respondEngineError(err);
  }
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(content-studio): POST /api/attempts/transcribe (Whisper dictation)`

---

### Task 3: `POST /api/attempts/tts` — text-to-speech read-aloud

**Files:** Create `src/app/api/attempts/tts/route.ts` (+ test).

**Interfaces:** Consumes `resilientTextToSpeech`. JSON `{ text }`. `getUser` → 401; text non-empty, capped to 4096 chars; returns `audio/mpeg` bytes. `LlmExhaustedError` → `respondEngineError`. Consumed by `ReadAloudButton` (Task 5).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/attempts/tts/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const tts = vi.fn();
vi.mock('@/lib/ai/openai', () => ({ resilientTextToSpeech: (...a: unknown[]) => tts(...a) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: { getUser } }) }));

const req = (b: unknown) => new NextRequest('http://x/api/attempts/tts', { method: 'POST', body: JSON.stringify(b) });

beforeEach(() => {
  getUser.mockReset(); tts.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  tts.mockResolvedValue(Buffer.from([1, 2, 3]));
});

describe('POST /api/attempts/tts', () => {
  it('401 / 400 gates', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/attempts/tts/route');
    expect((await POST(req({ text: 'hi' }))).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    expect((await POST(req({ text: '   ' }))).status).toBe(400);
  });
  it('returns audio/mpeg bytes on success', async () => {
    const { POST } = await import('@/app/api/attempts/tts/route');
    const res = await POST(req({ text: 'Read this aloud.' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await res.arrayBuffer()).byteLength).toBe(3);
  });
  it('caps text to 4096 chars', async () => {
    const { POST } = await import('@/app/api/attempts/tts/route');
    await POST(req({ text: 'a'.repeat(5000) }));
    expect((tts.mock.calls[0][0] as string).length).toBe(4096);
  });
  it('503 when TTS exhausts the LLM', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    tts.mockRejectedValue(new LlmExhaustedError('openai'));
    const { POST } = await import('@/app/api/attempts/tts/route');
    expect((await POST(req({ text: 'hi' }))).status).toBe(503);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write the route**

```ts
// src/app/api/attempts/tts/route.ts
// POST — read text aloud (OpenAI TTS). Stateless: any authenticated user may have text read aloud,
// so getUser is the only gate. Returns audio/mpeg bytes streamed to an <audio> element; not stored.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resilientTextToSpeech } from '@/lib/ai/openai';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';

const MAX_CHARS = 4096; // OpenAI TTS input limit

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { text?: string } | null;
    const text = body?.text?.trim();
    if (!text) return NextResponse.json({ error: 'Missing text' }, { status: 400 });

    const audio = await resilientTextToSpeech(text.slice(0, MAX_CHARS));
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('[attempts/tts] error:', err);
    return respondEngineError(err);
  }
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(content-studio): POST /api/attempts/tts (read-aloud)`

---

### Task 4: `MicButton` — record → transcribe → onTranscript

**Files:** Create `src/app/(student)/student/assignments/[id]/play/_components/MicButton.tsx` (+ test).

**Interfaces:** Produces `interface MicButtonProps { onTranscript: (text: string) => void; label?: string; disabled?: boolean }`; default export. Returns `null` when `MediaRecorder`/`getUserMedia` is unavailable. Tap → record (≤ 60 s, auto-stop) → tap again to stop → POST blob to `/api/attempts/transcribe` → `onTranscript(transcript)`. Consumed by Tasks 6 + 7.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MicButton from '../MicButton';

let recorder: { start: () => void; stop: () => void; state: string; ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void };

class FakeRecorder {
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() { recorder = this as never; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) }); this.onstop?.(); }
  static isTypeSupported() { return true; }
}

beforeEach(() => {
  (globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
  };
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ transcript: 'spoken words' }), { status: 200 })) as unknown as typeof fetch;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('MicButton', () => {
  it('renders null when MediaRecorder is unavailable', () => {
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = undefined;
    const { container } = render(<MicButton onTranscript={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it('records, stops, transcribes, and calls onTranscript', async () => {
    const onTranscript = vi.fn();
    render(<MicButton onTranscript={onTranscript} label="Dictate" />);
    fireEvent.click(screen.getByRole('button', { name: /dictate/i }));         // start
    await waitFor(() => expect(recorder.state).toBe('recording'));
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));            // stop → transcribe
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('spoken words'));
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write the component**

```tsx
'use client';

/**
 * MicButton — tap to record speech; the recording is transcribed to text (OpenAI Whisper via
 * /api/attempts/transcribe) and handed to onTranscript (the caller appends it). Renders null when
 * the browser lacks getUserMedia/MediaRecorder, so typing always remains the path. Token-only;
 * deep-ink; reduced-motion-safe. Strings DRAFT → Barb.
 */
import React, { useRef, useState } from 'react';

export interface MicButtonProps {
  onTranscript: (text: string) => void;
  label?: string;
  disabled?: boolean;
}

const MAX_MS = 60_000;

function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== 'undefined' && typeof (window as { MediaRecorder?: unknown }).MediaRecorder !== 'undefined'
  );
}

export function MicButton({ onTranscript, label = 'Dictate', disabled }: MicButtonProps): React.JSX.Element | null {
  const [state, setState] = useState<'idle' | 'recording' | 'working' | 'error'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportedRef = useRef<boolean>(micSupported());

  if (!supportedRef.current) return null;

  async function transcribe(blob: Blob) {
    try {
      const form = new FormData();
      form.append('file', blob, blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm');
      const res = await fetch('/api/attempts/transcribe', { method: 'POST', body: form });
      if (!res.ok) { setState('error'); return; }
      const body = (await res.json()) as { transcript?: string };
      const text = (body.transcript ?? '').trim();
      if (text) onTranscript(text);
      setState('idle');
    } catch { setState('error'); }
  }

  async function start() {
    if (disabled || state === 'recording' || state === 'working') return;
    setState('recording');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void transcribe(new Blob(chunksRef.current, { type: mime }));
      };
      recorderRef.current = rec;
      rec.start();
      stopTimerRef.current = setTimeout(() => stop(), MAX_MS);
    } catch { setState('error'); }
  }

  function stop() {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') { setState('working'); rec.stop(); }
  }

  const recording = state === 'recording';
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={disabled || state === 'working'}
        aria-pressed={recording}
        aria-label={recording ? 'Stop recording' : label}
        className={[
          'inline-flex items-center gap-1 rounded-md border-2 border-sidebar-edge px-3 py-1 text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50',
          recording ? 'bg-warn-surface text-fg motion-safe:animate-pulse' : 'bg-surface text-fg',
        ].join(' ')}
      >
        <span aria-hidden="true">🎤</span>
        {state === 'working' ? 'Transcribing…' : recording ? 'Stop' : label}
      </button>
      {state === 'error' && <span role="alert" className="text-sm text-fg-muted">Didn&apos;t catch that — try again.</span>}
    </div>
  );
}

export default MicButton;
```

- [ ] **Step 4: Run → PASS (2/2).** **Step 5: Commit** `feat(content-studio): MicButton (record → Whisper → text)`

---

### Task 5: `ReadAloudButton` — TTS playback

**Files:** Create `src/app/(student)/student/assignments/[id]/play/_components/ReadAloudButton.tsx` (+ test).

**Interfaces:** Produces `interface ReadAloudButtonProps { text: string; onPlay?: () => void; label?: string }`; default export. Returns `null` when `text` is empty. Tap → POST `{ text }` to `/api/attempts/tts` → play the returned MP3 via `<audio>`; tap again to stop. Fires `onPlay` once (first successful play) — feeds `ttsPlayCount`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReadAloudButton from '../ReadAloudButton';

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }), { status: 200 })) as unknown as typeof fetch;
  // jsdom: stub the unsupported media + URL bits.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
});

describe('ReadAloudButton', () => {
  it('renders null for empty text', () => {
    const { container } = render(<ReadAloudButton text="   " />);
    expect(container.firstChild).toBeNull();
  });
  it('fetches TTS, plays, and fires onPlay once', async () => {
    const onPlay = vi.fn();
    render(<ReadAloudButton text="Read this passage aloud." onPlay={onPlay} label="Listen" />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(onPlay).toHaveBeenCalledTimes(1);
    const body = JSON.parse(((globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body) as string);
    expect(body.text).toMatch(/Read this passage/);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write the component**

```tsx
'use client';

/**
 * ReadAloudButton — plays a passage aloud (OpenAI TTS via /api/attempts/tts), toggling play/stop.
 * Fires onPlay once on the first successful play so the player can count it (ttsPlayCount). Returns
 * null when there is nothing to read. Token-only; deep-ink. Strings DRAFT → Barb.
 */
import React, { useRef, useState } from 'react';

export interface ReadAloudButtonProps {
  text: string;
  onPlay?: () => void;
  label?: string;
}

const MAX_CHARS = 4096;

export function ReadAloudButton({ text, onPlay, label = 'Listen' }: ReadAloudButtonProps): React.JSX.Element | null {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const playedOnce = useRef(false);

  if (!text.trim()) return null;

  function cleanup() {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    audioRef.current = null;
  }
  function stop() {
    audioRef.current?.pause();
    cleanup();
    setState('idle');
  }

  async function play() {
    if (state === 'loading' || state === 'playing') { stop(); return; }
    setState('loading');
    try {
      const res = await fetch('/api/attempts/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, MAX_CHARS) }),
      });
      if (!res.ok) { setState('error'); return; }
      const url = URL.createObjectURL(await res.blob());
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { cleanup(); setState('idle'); };
      audio.onerror = () => { cleanup(); setState('error'); };
      await audio.play();
      if (!playedOnce.current) { playedOnce.current = true; onPlay?.(); }
      setState('playing');
    } catch { setState('error'); }
  }

  const active = state === 'playing' || state === 'loading';
  return (
    <button
      type="button"
      onClick={play}
      aria-pressed={active}
      aria-label={active ? 'Stop' : label}
      className="inline-flex items-center gap-1 rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span aria-hidden="true">🔊</span>
      {state === 'loading' ? 'Loading…' : active ? 'Stop' : label}
    </button>
  );
}

export default ReadAloudButton;
```

- [ ] **Step 4: Run → PASS (2/2).** **Step 5: Commit** `feat(content-studio): ReadAloudButton (TTS playback)`

---

### Task 6: Dictate into the teacher's "describe a lesson" box

**Files:** Modify `src/app/(teacher)/upload/_components/GenerateLessonStudio.tsx`; extend its test.

- [ ] **Step 1: Edit the component.** Add the import: `import MicButton from '../../../(student)/student/assignments/[id]/play/_components/MicButton';` (or the `@/` alias path to the same file). Replace the description `<label>` block (lines ~68-75) with a heading row carrying the mic:

```tsx
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className={LABEL}>What should this lesson teach?</span>
          <MicButton label="Dictate" onTranscript={(t) => setDescription((p) => (p.trim() ? `${p.trim()} ${t}` : t))} />
        </div>
        <textarea
          aria-label="Describe what to teach"
          className={`${INPUT} min-h-32`} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. A 7th-grade intro to photosynthesis: inputs, outputs, and why it matters."
        />
      </div>
```

- [ ] **Step 2: Add a failing test** (extend the existing test file; stub MediaRecorder + getUserMedia + the transcribe fetch, mirroring the MicButton test). Assert: clicking the mic (start), then stop, dictates a transcript that is appended to the description textarea (its value contains the transcript).

```tsx
  it('dictation appends the transcript to the description', async () => {
    let rec: { state: string; ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void } = { state: 'inactive' };
    class FakeRec { state = 'inactive'; ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null;
      constructor() { rec = this as never; } start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) }); this.onstop?.(); }
      static isTypeSupported() { return true; } }
    (globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) };
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRec;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ transcript: 'photosynthesis basics' }), { status: 200 })) as unknown as typeof fetch;

    render(<GenerateLessonStudio classId="c1" schoolState={null} />);
    fireEvent.click(screen.getByRole('button', { name: /dictate/i }));
    await waitFor(() => expect(rec.state).toBe('recording'));
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect((screen.getByLabelText(/describe what to teach/i) as HTMLTextAreaElement).value).toMatch(/photosynthesis basics/));
  });
```

- [ ] **Step 3: Run → existing tests + the new one PASS.** `npx vitest run "src/app/(teacher)/upload/_components/__tests__/GenerateLessonStudio.test.tsx"`

- [ ] **Step 4: Commit** `feat(content-studio): dictate the lesson description (mic in Generate tab)`

---

### Task 7: Dictate into the student's answer box

**Files:** Modify `src/app/(student)/student/assignments/[id]/play/_components/TaskCard.tsx`; extend its test.

- [ ] **Step 1: Edit the component.** Add `import MicButton from './MicButton';`. Insert a mic row immediately AFTER the textarea (line ~64) and BEFORE the image-affordance block:

```tsx
      <div>
        <MicButton
          label="Speak your answer"
          onTranscript={(t) => { fireFirstInput(); onChange(value.trim() ? `${value.trim()} ${t}` : t); }}
        />
      </div>
```

- [ ] **Step 2: Add a failing test** (extend the TaskCard test; same MediaRecorder/getUserMedia/fetch stubs as Task 4). Assert: dictating calls `onChange` with the transcript appended to the current `value`.

```tsx
  it('dictation appends the transcript via onChange', async () => {
    // (reuse the MicButton stubs: FakeRecorder on globalThis.MediaRecorder, getUserMedia, and a
    //  fetch returning { transcript: 'my spoken answer' }).
    const onChange = vi.fn();
    render(<TaskCard {...base} value="Already typed." onChange={onChange} imageUrl={null} onSaveImage={async () => {}} onRemoveImage={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /speak your answer/i }));
    // stop → transcribe → onChange
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Already typed. my spoken answer'));
  });
```

- [ ] **Step 3: Run → existing TaskCard tests + new one PASS.** **Step 4: Commit** `feat(content-studio): dictate the student answer (mic in TaskCard)`

---

### Task 8: Read the assignment passage aloud + light up `ttsPlayCount`

**Files:** Modify `ReadPhase.tsx` + `AssignmentPlayer.tsx`; extend `ReadPhase` test.

- [ ] **Step 1: Edit `ReadPhase.tsx`.** Add `import ReadAloudButton from './ReadAloudButton';`. Add `onTtsPlay?: () => void` to `ReadPhaseProps`. Render the read-aloud control on the passage (it reads `audio_script` when present, else the written passage). Replace the `{passage && (...)}` block (lines ~42-46) with:

```tsx
        {passage && (
          <div className="flex flex-col gap-2 rounded-lg border-2 border-surface bg-surface px-5 py-4">
            <ReadAloudButton text={content.audio_script || passage} onPlay={onTtsPlay} label="Listen" />
            <div className="text-fg text-sm leading-relaxed"><MathText>{passage}</MathText></div>
          </div>
        )}
```

(Update the function signature to destructure `onTtsPlay`.)

- [ ] **Step 2: Edit `AssignmentPlayer.tsx`.**
  - Add a ref alongside the other session refs (near `canvasUsedRef`): `const sessTtsPlayCount = useRef<number>(0);`
  - In `buildSessionAggregates()`, replace the hardcoded `ttsPlayCount: 0,` line with `ttsPlayCount: sessTtsPlayCount.current,`
  - In the `state === 'read'` render, pass the handler: `<ReadPhase content={content} onStart={handleStart} onTtsPlay={() => { sessTtsPlayCount.current += 1; }} />`

- [ ] **Step 3: Add a failing test** to the ReadPhase test (create the test file if absent). Stub `fetch` (TTS) + `HTMLMediaElement.prototype.play` + `URL.createObjectURL` as in the ReadAloudButton test. Assert: the "Listen" button renders when a passage exists; clicking it fires `onTtsPlay`.

```tsx
  it('shows a Listen button on the passage and fires onTtsPlay when played', async () => {
    globalThis.fetch = vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }), { status: 200 })) as unknown as typeof fetch;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()); HTMLMediaElement.prototype.pause = vi.fn();
    const onTtsPlay = vi.fn();
    render(<ReadPhase content={{ title: 'T', reading_passage: 'A passage to read.', audio_script: 'Spoken version.', tasks: [{ step: 1, description: 'q' }] }} onStart={() => {}} onTtsPlay={onTtsPlay} />);
    fireEvent.click(screen.getByRole('button', { name: /listen/i }));
    await waitFor(() => expect(onTtsPlay).toHaveBeenCalledTimes(1));
  });
```

- [ ] **Step 4: Run → ReadPhase test + the existing player tests PASS.** `npx vitest run "src/app/(student)/student/assignments/[id]/play/_components/__tests__/ReadPhase.test.tsx" "src/app/(student)/student/assignments/[id]/play/_components/__tests__/AssignmentPlayer.test.tsx"`

- [ ] **Step 5: Commit** `feat(content-studio): read-aloud on the assignment passage + ttsPlayCount signal`

---

### Task 9: Barb strings + full gate pass

**Files:** Modify `STRINGS-FOR-BARB.md` (§Content Studio — Seg 3).

- [ ] **Step 1: Add the DRAFT strings** under a "Seg 3 — Voice (dictation + read-aloud)" subheading: the mic labels ("Dictate", "Speak your answer", "Stop", "Transcribing…", "Didn't catch that — try again."), the "too short" / busy errors (the 503 envelope's "The system is busy…" already exists), and the read-aloud labels ("Listen", "Stop", "Loading…"). Mark all DRAFT → Barb.

- [ ] **Step 2: Run the full gate suite**

```bash
npx tsc --noEmit            # 0
npm test                    # all green
npm run build               # 0 (a11y + tokens via prebuild)
```

- [ ] **Step 3: Commit** `docs(content-studio): Seg 3 voice string drafts for Barb`

---

## Deferrals & decisions (carry into the final review + the merge call)

- **Both halves shipped** (Marvin): dictation (mic) + read-aloud (TTS).
- **Mic on the teacher describe-box AND the student answer-box** (Marvin) — one shared `MicButton` + one `/transcribe` route.
- **Server TTS (OpenAI `tts-1`, voice `nova`)** for read-aloud quality (Marvin), reading the already-generated `audio_script` (falls back to the written passage).
- **No DB, no storage, no migration** — dictated text flows into fields that already persist; read-aloud streams audio (never stored).
- **`whisper-1` transcription**, env-overridable (`OPENAI_TRANSCRIBE_MODEL`); language pinned `en` (V2 is en-only; pt-BR/EduFlux is deferred).
- **No usage-quota** (V1's per-school `whisper_seconds`/`tts_characters` caps) — V2 has no usage-caps table. Per-request size/length caps + the `getUser` gate bound per-call cost; a quota system is a **documented follow-up** (note: unbounded request *count* by an authenticated user is a theoretical cost vector, acceptable for the pilot).
- **`MicButton` returns null when unsupported** (no `getUserMedia`/`MediaRecorder`) → typing always works (graceful degradation; iOS Safari nuances handled by the webm→mp4 mime fallback).
- Deferred: a recording waveform/level meter (V1 had one); read-aloud word-highlighting; the quiz runner's `sessTtsPlayCount` (also dead) — out of scope (this segment is the assignment player + the teacher generate box).

## Self-Review (against the locked decisions)

- **Decision coverage:** dictation → Tasks 2, 4, 6, 7; read-aloud → Tasks 3, 5, 8; server TTS → Task 1/3; no-storage/no-migration → confirmed (no bucket/migration tasks); `ttsPlayCount` lit up → Task 8.
- **Contract safety:** dictation appends into the EXISTING `description` state (teacher) and the EXISTING `responses.image_url`-sibling `text` via `onChange` (student) — no new persistence; read-aloud reads existing `audio_script`/`reading_passage`.
- **Auth:** both routes are stateless and `getUser`-gated only (the audio/text is the caller's own; no object access → no IDOR surface). `LlmExhaustedError → respondEngineError`.
- **Type consistency:** `MicButton`/`ReadAloudButton` prop shapes (Tasks 4/5) match their call sites (Tasks 6/7/8); the route response shapes (`{transcript}` / `audio/mpeg`) match the component consumers.
- **a11y:** mic null-degrades; buttons carry state-reflecting accessible names; reduced-motion pulse; the read-aloud reads the conversational `audio_script`. No "Homework". Token-only.

## Execution Handoff

**Plan saved to `docs/superpowers/plans/2026-06-23-content-studio-seg3.md`.** Recommended: **subagent-driven** — fresh implementer per task, task review between, a final 5-lens whole-branch adversarial review, then Playwright preview (mic + listen) for Marvin and the merge call. **No migration** to apply.
