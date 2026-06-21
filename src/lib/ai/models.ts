// ============================================================
// src/lib/ai/models.ts
// Central registry of AI model IDs — single source of truth (LIFT V1 lib/ai/models.ts).
// Never hardcode a model ID at a call site. IDs are dated — re-pin at build.
//
// CALIBRATION CONTRACT: these constants are calibration-locked. The grading
// model (CLAUDE_GRADING_MODEL) is locked to the V1-proven Sonnet class that
// matches the locked eval corpus; overridable via env.
// Pending: week-1 Opus spike — candidate: claude-opus-4-8 (spec §3.1).
// ============================================================

/**
 * Anthropic model for quiz/HW grading + homework differentiation.
 * CALIBRATION-LOCKED — do not change the value without the eval rig.
 * Pending week-1 spike: claude-opus-4-8 as grader candidate (not wired yet).
 */
export const CLAUDE_GRADING_MODEL =
  process.env.ANTHROPIC_GRADING_MODEL || 'claude-sonnet-4-6';

/**
 * Anthropic model for GENERATION (assignment gen) — separate from the
 * calibration-locked grader. A pilot lever, env-overridable, defaults to
 * sonnet so an unset var changes nothing. Isolates assignment-gen from a
 * future grader Opus flip.
 */
export const CLAUDE_GEN_MODEL =
  process.env.ANTHROPIC_GEN_MODEL || 'claude-sonnet-4-6';

/**
 * OpenAI model for generation + diagnostic paths (lesson gen, quiz gen, etc.).
 * CALIBRATION-SENSITIVE — frozen to gpt-4o; do not move without an eval pass.
 */
export const OPENAI_GEN_MODEL = process.env.OPENAI_GEN_MODEL || 'gpt-4o';

/**
 * OpenAI model for non-graded voice/tone surfaces (Teli chat, tutor/hint, etc.).
 * PILOT LEVER — env-overridable; defaults to gpt-4o so an unset var changes nothing.
 */
export const OPENAI_VOICE_MODEL = process.env.OPENAI_VOICE_MODEL || 'gpt-4o';

/** Single object the eval rig + Spark cache fingerprint read. */
export const MODELS = {
  grading: CLAUDE_GRADING_MODEL,
  claude_generation: CLAUDE_GEN_MODEL,
  generation: OPENAI_GEN_MODEL,
  voice: OPENAI_VOICE_MODEL,
} as const;

/**
 * Anthropic model for Teli — the Socratic tutor in the Assignment Player.
 * NEVER reveals the answer; fail-closed reveal-check runs on every reply.
 * Env-overridable so staging can swap without a deploy.
 */
export const CLAUDE_TUTOR_MODEL =
  process.env.ANTHROPIC_TUTOR_MODEL || 'claude-opus-4-8';

/**
 * Cheap Anthropic model for the output-boundary reveal classifier.
 * Failure/unavailability causes fail-closed fallback (never certifies without a response).
 */
export const CLAUDE_TUTOR_CHECK_MODEL =
  process.env.ANTHROPIC_TUTOR_CHECK_MODEL || 'claude-haiku-4-5';

/** Bumped whenever a calibration-locked prompt changes (eval drift trigger). */
export const PROMPT_VERSION = '1.0.0';
/** Bumped whenever a calibration-locked model ID changes (eval drift trigger). */
export const MODEL_VERSION = `${CLAUDE_GRADING_MODEL}+${OPENAI_GEN_MODEL}`;

// ── Token-limit param compatibility (LIFT V1 verbatim) ──
// The gpt-4 / gpt-3 families use `max_tokens`. Newer OpenAI models
// (gpt-5 family, o-series) renamed it to `max_completion_tokens` and
// reject `max_tokens` with a 400. Probed live 2026-05-30: gpt-5.4-mini
// accepts `temperature` fine but requires `max_completion_tokens`.

/** True for models that still take the legacy `max_tokens` param. */
export function usesLegacyTokenParam(model: string): boolean {
  return /^(gpt-4|gpt-3|ft:gpt-[34])/.test(model);
}

/**
 * Returns the correct token-limit param object for the given model:
 * `{ max_tokens: n }` for gpt-4/3, `{ max_completion_tokens: n }` for newer.
 * Spread into a chat.completions.create() call.
 */
export function tokenLimitParams(
  model: string,
  n: number,
): { max_tokens: number } | { max_completion_tokens: number } {
  return usesLegacyTokenParam(model) ? { max_tokens: n } : { max_completion_tokens: n };
}
