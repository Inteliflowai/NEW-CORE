// src/lib/teli/generateHint.ts
// Teli's guarded hint generator — the moat's keystone (Assignment Player Segment 3).
//
// THE INVARIANT: generateGuardedHint ALWAYS returns a checked, safe string. Teli NEVER
// reveals the answer. Defense in depth, fail-closed:
//   (1) bounded ladder + no answer key in the prompt (upstream — prompt.ts / ladder.ts)
//   (2) always-on synchronous gate (heuristic reveal patterns + banned diagnostic words)
//   (3) an output-boundary LLM reveal classifier that FAILS CLOSED — a classifier or model
//       outage yields the safe fallback, NEVER un-certified text. The guarantee outranks
//       availability (spec §6.1): a reveal-classifier outage degrades Teli to the safe
//       scaffold line rather than risk leaking the answer. This degradation is intended.
//
// Numbers ARE allowed in tutor turns — the wall is the reveal-check, not a numeral ban,
// so this module uses failsSyncGate (NOT the blanket digit-ban hasLeak).
//
// Memory: v2-teli-tutor-never-reveals-answer. Copy = DRAFT → Barb (STRINGS-FOR-BARB.md).

import { claudeChat } from '@/lib/ai/claude';
import { CLAUDE_TUTOR_MODEL, CLAUDE_TUTOR_CHECK_MODEL } from '@/lib/ai/models';
import { buildTeliSystemPrompt, MOVE_NUDGE } from './prompt';
import { failsSyncGate, namesAThinkingMove } from './revealCheck';
import type { HintRung } from './ladder';

/** Fixed, certified-safe scaffold line shown whenever safety cannot be established. DRAFT → Barb. */
export const SAFE_FALLBACK_REPLY =
  "Let's slow down and take it one piece at a time — what's the very first thing the question is asking you to find? Tell me that and we'll build from there.";

/** Stricter suffix appended on a reveal-suspected regenerate (layer-3 second pass). */
const REVEAL_NUDGE =
  '\n\nIMPORTANT: do NOT state, hint at, or hand over any part of the answer, result, or final value. Guide ONLY with a question or a thinking move.';

export interface GenerateGuardedHintOpts {
  taskDescription: string;
  studentResponse?: string;
  rung: HintRung | null;
  isHelpRequest: boolean;
  studentMessage: string;
  studentContext?: { learningStyle?: string; recentStruggleTopics?: string[] };
}

/**
 * ONE cheap-model call to classify whether a reply reveals the answer.
 * FAILS CLOSED: on any throw (LlmExhaustedError) OR a null return, yields 'unavailable'
 * (never 'ok') so the caller cannot certify an unchecked reply.
 */
async function classifyReveal(reply: string): Promise<'ok' | 'reveal' | 'unavailable'> {
  const system =
    'You are a strict safety classifier for a Socratic tutor. The tutor must NEVER reveal, ' +
    'state, or hand over the answer, the final result, or any part of the solution — it may only ' +
    'guide with questions and thinking moves. Read the tutor reply below. Respond with EXACTLY one ' +
    'word: REVEAL if it discloses the answer/result/solution (in whole or part), or OK if it only ' +
    'guides without giving anything away. Numbers used only to frame a question are fine.';
  let verdict: string | null;
  try {
    verdict = await claudeChat(system, `Tutor reply:\n${reply}`, {
      model: CLAUDE_TUTOR_CHECK_MODEL,
      temperature: 0,
      maxTokens: 8,
    });
  } catch {
    // LlmExhaustedError (retry exhaustion) → cannot verify → fail closed.
    return 'unavailable';
  }
  // Only an EXPLICIT, EXACT one-word verdict certifies. The classifier is instructed to reply
  // with EXACTLY one word; anything else (garbled, refusal, hedge, truncated — ".", "Unsure",
  // "Not OK to share that", "Looks OK but…") fails closed. CERTIFICATION USES EXACT-WORD EQUALITY,
  // never a substring \bOK\b: a hedged/negated string that merely CONTAINS "OK" is non-conforming
  // and must NEVER certify an un-vetted reply (that path fails OPEN — the one defect this guards).
  if (verdict == null) return 'unavailable';
  if (/^\s*REVEAL\b[.!]?\s*$/i.test(verdict)) return 'reveal';
  if (/^\s*OK\b[.!]?\s*$/i.test(verdict)) return 'ok';
  // REVEAL wins even if embedded — a verdict naming REVEAL anywhere is treated as a reveal (fail-safe).
  if (/\bREVEAL\b/i.test(verdict)) return 'reveal';
  return 'unavailable';
}

/**
 * Three-state safety assessment. 'cannot-verify' is the fail-closed state: the model was
 * unavailable OR the classifier could not certify — the caller MUST NOT ship the reply.
 */
async function assessSafety(reply: string | null): Promise<'safe' | 'unsafe' | 'cannot-verify'> {
  if (reply == null) return 'cannot-verify'; // model exhausted/unavailable
  if (failsSyncGate(reply)) return 'unsafe'; // always-on (heuristic reveal OR banned diagnostic word)
  const v = await classifyReveal(reply);
  if (v === 'reveal') return 'unsafe';
  if (v === 'unavailable') return 'cannot-verify'; // FAIL CLOSED — never certify without the classifier
  return 'safe';
}

/**
 * One generation attempt. Catches LlmExhaustedError so a model outage flows to the safe
 * path (returns null) rather than escaping as a 500.
 */
async function tryGenerate(system: string, studentMessage: string): Promise<string | null> {
  try {
    return await claudeChat(system, studentMessage, {
      model: CLAUDE_TUTOR_MODEL,
      temperature: 0.7,
      maxTokens: 300,
    });
  } catch {
    return null; // LlmExhaustedError → safe path
  }
}

/**
 * Generate a guarded Socratic hint. ALWAYS resolves to a checked, safe string.
 * On any reveal suspicion, missing thinking-move, model outage, or classifier outage,
 * regenerates once and then degrades to SAFE_FALLBACK_REPLY — never un-certified text.
 */
export async function generateGuardedHint(opts: GenerateGuardedHintOpts): Promise<string> {
  const sys = buildTeliSystemPrompt({
    taskDescription: opts.taskDescription,
    studentResponse: opts.studentResponse,
    rung: opts.rung,
    isHelpRequest: opts.isHelpRequest,
    studentContext: opts.studentContext,
  });

  let reply = await tryGenerate(sys, opts.studentMessage);
  let verdict = await assessSafety(reply);

  // First-pass accept: safe AND (free turn OR it names a thinking move).
  if (verdict === 'safe' && (!opts.isHelpRequest || namesAThinkingMove(reply!))) {
    return reply!;
  }

  // Regenerate ONCE. Stricter reveal suffix if unsafe/unverifiable; else a move nudge.
  const suffix = verdict !== 'safe' ? REVEAL_NUDGE : MOVE_NUDGE;
  reply = await tryGenerate(sys + suffix, opts.studentMessage);
  verdict = await assessSafety(reply);

  // On the 2nd pass, safety trumps a missing move.
  if (verdict === 'safe') return reply!;

  return SAFE_FALLBACK_REPLY;
}
