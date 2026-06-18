// src/lib/engine/assignmentGen.ts
// Engine call #5 (+ #5a) — import-safe (no next/server, no module-load SDK construction).
//
// generateAssignment: Claude primary (temp 0.7, 4500 tok, 120s) → GPT fallback.
//   C1: EACH leg is independently wrapped in try/catch — the wrappers THROW
//       LlmExhaustedError, NOT return null; an unwrapped Claude throw would
//       kill the GPT leg. On both legs exhausted or both unparseable → throws
//       LlmExhaustedError. NEVER silently substitutes a band or style.
//
// inferLearningStyle (#5a): GPT-only (temp 0.3). On any throw, null, or
//   parse-fail → degrades to { learning_style: 'emerging', confidence: 0 }.
//   Must NOT propagate (degrade path, never rethrow).

import { claudeChat } from '@/lib/ai/claude';
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import {
  ASSIGNMENT_SYSTEM,
  assignmentPrompt,
  getStrategiesForStudent,
  LEARNING_STYLE_SYSTEM,
  learningStylePrompt,
} from '@/lib/openai/prompts';
import {
  AssignmentSchema,
  type Assignment,
  LearningStyleSchema,
  type LearningStyle,
} from '@/lib/engine/types';
import { LlmExhaustedError } from '@/lib/ai/errors';

export interface AssignmentInput {
  lessonSummary: string;
  /** The quiz-score mastery band (never null — route must refuse if absent, C20). */
  band: 'reteach' | 'grade_level' | 'advanced';
  /** Learning style in 6-value prompt vocabulary (read_write/tactile pass through to
   *  getStrategiesForStudent; DB normalization happens at the route, not here). */
  style: string;
  studentName: string;
  sparkEnabled?: boolean;
  targetedPractice?: boolean;
}

/**
 * Generate a differentiated assignment for a student.
 * Claude primary → GPT fallback (C1: each leg independently try/catch'd).
 * Throws LlmExhaustedError when both legs are exhausted or unparseable.
 * NEVER substitutes a band or style silently.
 */
export async function generateAssignment(input: AssignmentInput): Promise<Assignment> {
  const strategies = getStrategiesForStudent(input.band, input.style).map((s) => ({
    name: s.name,
    what_students_do: s.what_students_do,
    atl_skills: s.atl_skills,
    ib_learner_profile: s.ib_learner_profile,
    bloom_level: s.bloom_level,
  }));

  const userPrompt = assignmentPrompt(
    input.lessonSummary,
    input.band,
    input.style,
    input.studentName,
    strategies,
    input.sparkEnabled,
    input.targetedPractice,
  );

  // ── Primary: Claude (temp 0.7, 4500 tok, 120s timeout) ───────────────────
  let claudeRaw: string | null = null;
  try {
    claudeRaw = await claudeChat(ASSIGNMENT_SYSTEM, userPrompt, {
      temperature: 0.7,
      maxTokens: 4500,
      timeoutMs: 120000,
    });
  } catch {
    // C1: swallow LlmExhaustedError or any other throw — fall through to GPT
  }
  if (claudeRaw) {
    const parsed = tryParseAssignment(claudeRaw);
    if (parsed) return parsed;
  }

  // ── Fallback: GPT (OPENAI_GEN_MODEL = gpt-4o) ────────────────────────────
  let gptRaw: string | null = null;
  try {
    const completion = await resilientChatCompletion(
      {
        model: OPENAI_GEN_MODEL,
        messages: [
          { role: 'system', content: ASSIGNMENT_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 4500,
        response_format: { type: 'json_object' },
      },
      { timeoutMs: 45000 },
    );
    gptRaw = completion?.choices?.[0]?.message?.content ?? null;
  } catch {
    // C1: swallow — terminal below
  }
  if (gptRaw) {
    const parsed = tryParseAssignment(gptRaw);
    if (parsed) return parsed;
  }

  // Both legs exhausted or both produced unparseable output — NEVER fabricate.
  throw new LlmExhaustedError('claude+openai');
}

/** Parse + validate a raw LLM string against AssignmentSchema. Returns null on any failure. */
function tryParseAssignment(raw: string): Assignment | null {
  try {
    const result = AssignmentSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Infer learning style from behavioral signals. Engine call #5a.
 * GPT-only (temp 0.3). Degrades gracefully — NEVER rethrows.
 * On any throw (LlmExhaustedError), null completion, or parse/zod failure →
 * returns { learning_style: 'emerging', confidence: 0 }.
 */
export async function inferLearningStyle(signals: string): Promise<LearningStyle> {
  const DEGRADE: LearningStyle = { learning_style: 'emerging', confidence: 0 };
  try {
    const completion = await resilientChatCompletion({
      model: OPENAI_GEN_MODEL,
      messages: [
        { role: 'system', content: LEARNING_STYLE_SYSTEM },
        { role: 'user', content: learningStylePrompt(signals) },
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });
    const raw = completion?.choices?.[0]?.message?.content;
    if (!raw) return DEGRADE;
    const result = LearningStyleSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : DEGRADE;
  } catch {
    // C1: LlmExhaustedError or parse error — degrade, never rethrow
    return DEGRADE;
  }
}
