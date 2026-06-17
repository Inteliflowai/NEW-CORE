// src/lib/ai/claude.ts
// Resilient Anthropic Claude wrapper with retry logic (LIFT V1 lib/claude/client.ts).
// Throws LlmExhaustedError after all retries are exhausted; never silently returns null
// on terminal failure so callers get a typed, catchable signal.
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_GRADING_MODEL } from '@/lib/ai/models';
import { LlmExhaustedError } from '@/lib/ai/errors';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeChatParams {
  system?: string;
  messages: ClaudeMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface ClaudeChatResult {
  content: string;
}

/**
 * Resilient Claude chat completion with exponential backoff retry.
 * Returns the text content of the first response block.
 * Throws LlmExhaustedError when all retries are exhausted (primary + fallback attempts).
 * Returns null only for non-retryable errors (400/401/404) or missing text blocks.
 */
export async function resilientClaudeChat(
  params: ClaudeChatParams,
  options: RetryOptions = {},
): Promise<ClaudeChatResult | null> {
  const { maxRetries = 3, initialDelayMs = 1000, maxDelayMs = 10000, timeoutMs = 30000 } = options;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let abortedByTimer = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        abortedByTimer = true;
        controller.abort();
      }, timeoutMs);

      const response = await anthropic.messages.create({
        model: CLAUDE_GRADING_MODEL,
        max_tokens: params.max_tokens || 1024,
        temperature: params.temperature ?? 0.3,
        system: params.system,
        messages: params.messages.map(m => ({ role: m.role, content: m.content })),
      }, { signal: controller.signal });

      clearTimeout(timer);

      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        console.warn('[Claude] No text content in response');
        return null;
      }

      return { content: textBlock.text };
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      lastErr = err;

      // Non-retryable: auth/bad-request
      if (error.status === 400 || error.status === 401 || error.status === 404) {
        console.error(`[Claude] Non-retryable error (${error.status}):`, error.message);
        return null;
      }

      // Don't retry on our own timeout abort — burn no more budget, let caller fall back
      if (abortedByTimer) {
        console.warn(
          `[Claude] Aborted by timeout (${timeoutMs}ms) on attempt ${attempt + 1} — short-circuiting retry budget so caller can fall back`,
        );
        return null;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
        console.warn(
          `[Claude] Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${delay}ms:`,
          error.message,
        );
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[Claude] All ${maxRetries + 1} attempts failed:`, error.message);
        throw new LlmExhaustedError('claude', lastErr);
      }
    }
  }

  // Unreachable — either returned or threw above — but satisfies TS control flow
  throw new LlmExhaustedError('claude', lastErr);
}

/**
 * Compatibility wrapper: takes OpenAI-style system+user messages
 * and returns just the text content string (or null).
 * Drop-in replacement for resilientChatCompletion in grading/assignment contexts.
 */
export async function claudeChat(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number; timeoutMs?: number },
): Promise<string | null> {
  const result = await resilientClaudeChat({
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens || 1024,
  }, { timeoutMs: options?.timeoutMs || 30000 });
  return result?.content || null;
}
