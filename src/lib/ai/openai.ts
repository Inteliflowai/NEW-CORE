// src/lib/ai/openai.ts
// Resilient OpenAI wrapper with exponential backoff retry (LIFT V1 lib/openai/resilient.ts).
// Throws LlmExhaustedError after all retries are exhausted; never silently returns null
// on terminal failure so callers get a typed, catchable signal.
import OpenAI, { toFile } from 'openai';
import { usesLegacyTokenParam, OPENAI_TRANSCRIBE_MODEL, OPENAI_TTS_MODEL } from '@/lib/ai/models';
import { LlmExhaustedError } from '@/lib/ai/errors';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI { return (_openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY })); }

/**
 * Newer OpenAI models (gpt-5 family, o-series) reject `max_tokens` and
 * require `max_completion_tokens`. Translate transparently so a model
 * swap doesn't require touching callsites. No-op for gpt-4o (legacy).
 */
function normalizeTokenParam(
  params: OpenAI.Chat.ChatCompletionCreateParams,
): OpenAI.Chat.ChatCompletionCreateParams {
  const model = typeof params.model === 'string' ? params.model : '';
  if (usesLegacyTokenParam(model)) return params;
  if (params.max_tokens == null || params.max_completion_tokens != null) return params;
  const { max_tokens, ...rest } = params;
  return { ...rest, max_completion_tokens: max_tokens };
}

interface RetryOptions {
  maxRetries?: number;     // default 3
  initialDelayMs?: number; // default 1000
  maxDelayMs?: number;     // default 10000
  timeoutMs?: number;      // default 30000
}

/**
 * Resilient chat completion with exponential backoff retry.
 * Retries on: 429 (rate limit), 500, 502, 503 (server errors), timeout.
 * Does NOT retry on: 400 (bad request), 401 (auth), 404.
 * Throws LlmExhaustedError when all retries are exhausted (primary + fallback attempts).
 */
export async function resilientChatCompletion(
  params: OpenAI.Chat.ChatCompletionCreateParams,
  options: RetryOptions = {},
): Promise<OpenAI.Chat.ChatCompletion | null> {
  const { maxRetries = 3, initialDelayMs = 1000, maxDelayMs = 10000, timeoutMs = 30000 } = options;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const result = await getOpenAI().chat.completions.create(
        { ...normalizeTokenParam(params), stream: false },
        { signal: controller.signal },
      );

      clearTimeout(timeout);
      return result;
    } catch (error: unknown) {
      const err = error as { status?: number; response?: { status?: number }; message?: string };
      const status = err?.status || err?.response?.status;
      const isRetryable = !status || status === 429 || status >= 500;
      lastErr = error;

      if (!isRetryable || attempt === maxRetries) {
        console.error(`[OpenAI] Failed after ${attempt + 1} attempts:`, err?.message || error);
        throw new LlmExhaustedError('openai', lastErr);
      }

      // Exponential backoff with jitter
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs);
      console.warn(`[OpenAI] Attempt ${attempt + 1} failed (${status || 'timeout'}), retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Unreachable — either returned or threw above — but satisfies TS control flow
  throw new LlmExhaustedError('openai', lastErr);
}

/**
 * Resilient image generation with retry.
 * Throws LlmExhaustedError when all retries are exhausted.
 */
export async function resilientImageGeneration(
  params: OpenAI.Images.ImageGenerateParams,
  options: RetryOptions = {},
): Promise<OpenAI.Images.ImagesResponse | null> {
  const { maxRetries = 2, initialDelayMs = 2000, maxDelayMs = 15000, timeoutMs = 60000 } = options;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const result = await getOpenAI().images.generate(params, { signal: controller.signal }) as OpenAI.Images.ImagesResponse;
      clearTimeout(timeout);
      return result;
    } catch (error: unknown) {
      const err = error as { status?: number; response?: { status?: number }; message?: string };
      const status = err?.status || err?.response?.status;
      const isRetryable = !status || status === 429 || status >= 500;
      lastErr = error;

      if (!isRetryable || attempt === maxRetries) {
        console.error(`[OpenAI Image] Failed after ${attempt + 1} attempts:`, err?.message || error);
        throw new LlmExhaustedError('openai', lastErr);
      }

      const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + Math.random() * 500, maxDelayMs);
      console.warn(`[OpenAI Image] Attempt ${attempt + 1} failed (${status || 'timeout'}), retrying in ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Unreachable — either returned or threw above — but satisfies TS control flow
  throw new LlmExhaustedError('openai', lastErr);
}

// Lazy accessor for the raw client (no consumers in src/scripts — kept for compat)
export function getOpenAIClient(): OpenAI { return getOpenAI(); }

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
