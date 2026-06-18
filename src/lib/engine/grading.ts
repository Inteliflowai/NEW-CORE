// src/lib/engine/grading.ts
// Engine call #4 — OEQ grading (HIGHEST stakes). Import-safe: no next/server, no
// module-load SDK construction. LIFT V1 submit/route.ts grading call (temp 0.2, 600 tok).
//
// Claude primary (temp 0.2) → GPT fallback (OPENAI_GEN_MODEL).
// C1: BOTH legs wrapped in try/catch — the wrappers THROW LlmExhaustedError on exhaustion,
//     NOT return null. An unwrapped Claude 429 would propagate and kill the GPT fallback.
// C2: uses OPENAI_GEN_MODEL (gpt-4o) — NOT the phantom OPENAI_GRADING_FALLBACK.
// On both legs exhausted or both unparseable → throws LlmExhaustedError. NEVER fabricates.
//
// CALIBRATION NOTE: CLAUDE_GRADING_MODEL defaults to claude-sonnet-4-6 (V1-proven, corpus-
// calibrated). If the week-1 grader spike (Task 7) selects Opus 4.x, rebuild the request
// SHAPE in the @/lib/ai wrappers — this fn calls them unchanged.
import { claudeChat } from '@/lib/ai/claude';
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_GEN_MODEL, CLAUDE_GRADING_MODEL } from '@/lib/ai/models';
import { GRADING_SYSTEM, gradingPrompt } from '@/lib/openai/prompts';
import { GradingResultSchema, type GradingResult } from '@/lib/engine/types';
import { LlmExhaustedError } from '@/lib/ai/errors';

export interface GradeInput {
  questionText: string;
  rubric: string;
  response: string;
  rubricVersion?: string;
}

const SYSTEM = GRADING_SYSTEM + '\nReturn ONLY valid JSON. No markdown code fences.';

/**
 * Grade one open-response question.
 * Claude primary → GPT fallback. Throws LlmExhaustedError when both legs
 * are exhausted or produce unparseable output — NEVER returns a fabricated score.
 *
 * C1: each leg is independently try/catch'd so a thrown LlmExhaustedError from
 *     Claude does not kill the GPT fallback.
 */
export async function gradeOpenResponse(input: GradeInput): Promise<GradingResult> {
  const userPrompt = gradingPrompt(
    input.questionText,
    input.rubric,
    input.response || '',
    input.rubricVersion ?? 'v1',
  );

  // ── Primary: Claude (calibration-locked, temp 0.2, 600 tok) ─────────────
  let claudeRaw: string | null = null;
  try {
    claudeRaw = await claudeChat(SYSTEM, userPrompt, { temperature: 0.2, maxTokens: 600, model: CLAUDE_GRADING_MODEL });
  } catch {
    // swallow — LlmExhaustedError or any other throw — fall through to GPT
  }
  if (claudeRaw) {
    const parsed = tryParse(claudeRaw);
    if (parsed) return parsed;
  }

  // ── Fallback: GPT (OPENAI_GEN_MODEL = gpt-4o per C2) ────────────────────
  let gptRaw: string | null = null;
  try {
    const completion = await resilientChatCompletion({
      model: OPENAI_GEN_MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    gptRaw = completion?.choices?.[0]?.message?.content ?? null;
  } catch {
    // swallow — LlmExhaustedError or any other throw — terminal below
  }
  if (gptRaw) {
    const parsed = tryParse(gptRaw);
    if (parsed) return parsed;
  }

  // Both legs exhausted or both produced unparseable output — NEVER fabricate.
  throw new LlmExhaustedError('claude+openai');
}

/** Parse and validate a raw LLM string against GradingResultSchema. Returns null on any failure. */
function tryParse(raw: string): GradingResult | null {
  try {
    const result = GradingResultSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
