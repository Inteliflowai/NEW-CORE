// src/lib/engine/parentNarrative.ts
// Import-safe AI narrative engine for the parent Learning Summary.
//
// Four-audience wall: every paragraph + starter validated with parentLeaks before returning.
// NEVER throws — deterministic fallback on any AI failure, shape error, or leak violation.
//
// Flow: build prompt → resilientChatCompletion → shape-guard (I2) → per-item parentLeaks →
//       cold-start direction check (I4) → retry once with stricter suffix (I8) → fallback (M5).
//
// Mirrors generateHighFiveDraft (src/lib/highfives/generateDraft.ts) + json_object mode from
// lessonGenerate.ts (src/lib/engine/lessonGenerate.ts).
//
// Forbidden imports: next/server, Supabase SDK, loadStudentSignals, band/CL/risk fields.
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_VOICE_MODEL } from '@/lib/ai/models';
import {
  PARENT_NARRATIVE_SYSTEM,
  parentNarrativePrompt,
  parentNarrativeColdStartPrompt,
  PARENT_NARRATIVE_RETRY_SUFFIX,
} from '@/lib/openai/prompts';
import { parentLeaks } from '@/lib/copy/parentGuard';
import type { ParentContext } from '@/lib/parent/loadParentNarrativeContext';

// ── Constants ──────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 45_000;

/**
 * I4 — Direction words that must NOT appear in cold-start output.
 * A model fabricating "climbing steadily" when there is no trend history passes
 * parentLeaks (those words are not in the parent forbidden list) but fails here.
 */
const COLD_START_DIRECTION_RE =
  /\b(climbing|sliding|steady|improving|declining|trending|progress)\b/i;

// ── Public types ───────────────────────────────────────────────────────────────

export interface ParentNarrativeResult {
  paragraphs: string[];
  conversation_starters: string[];
  source: 'ai' | 'ai_retry' | 'fallback';
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * M5 — Deterministic fallback. Hard-coded warm, number-free, level-free paragraphs.
 * Validates the named variant with parentLeaks; falls back to a fully-static name-free
 * variant if a firstName edge-case somehow triggers a leak.
 */
function buildFallback(ctx: ParentContext): ParentNarrativeResult {
  const { firstName } = ctx;

  const namedParagraphs = [
    `${firstName} is working hard and developing new skills — the effort and curiosity they bring to learning is wonderful to see.`,
    `Every learner has a unique way of taking in new ideas. ${firstName} is building their own approach, and the more you talk with them about what they are thinking, the stronger that approach becomes.`,
    `One of the most powerful things you can do at home is simply have a conversation — ask ${firstName} what they found interesting, what felt tricky, or what they noticed. Those conversations keep learning alive.`,
    `Exploring topics from ${firstName}'s day through everyday activities — cooking, reading together, going outside, or just chatting — helps make learning feel real and connected.`,
    `There is a lot to celebrate about ${firstName}'s commitment to their work. Keep noticing and naming the effort — it matters more than any single result.`,
  ];
  const namedStarters = [
    `What was one thing that surprised you today?`,
    `If you had to explain something from this week to a younger kid, what would you pick?`,
  ];

  // Validate the named fallback (M5: run parentLeaks over fallback paragraphs + starters)
  const namedLeak = [...namedParagraphs, ...namedStarters].some(
    (t) => parentLeaks(t).length > 0,
  );

  if (!namedLeak) {
    return { paragraphs: namedParagraphs, conversation_starters: namedStarters, source: 'fallback' };
  }

  // Fully-static name-free variant — no firstName, guaranteed clean.
  const staticParagraphs = [
    'Your child is working hard and developing new skills — the effort and curiosity they bring to learning is wonderful to see.',
    'Every learner has a unique way of taking in new ideas. Talking with your child about what they are thinking helps strengthen that approach every day.',
    'One of the most powerful things you can do at home is have a conversation — ask what felt interesting, what felt tricky, or what they noticed.',
    'Exploring the topics from the school day through everyday activities helps make learning feel real and connected.',
    "There is a lot to celebrate about your child's commitment to their work. Keep noticing and naming the effort — it matters more than any single result.",
  ];
  const staticStarters = [
    'What was one thing that surprised you today?',
    'If you could explain something from this week to someone younger, what would you pick?',
  ];
  return { paragraphs: staticParagraphs, conversation_starters: staticStarters, source: 'fallback' };
}

/**
 * Calls resilientChatCompletion and swallows any failure — both synchronous throws
 * and rejected promises (LlmExhaustedError after retries). Returns null on any failure;
 * the caller routes to retry / fallback.
 *
 * NOTE: `return await` inside an async try/catch catches BOTH synchronous throws
 * (the await unwraps the expression synchronously before returning) AND rejected promises
 * (the await converts a rejection to a caught exception). This mirrors the proven pattern
 * in generateHighFiveDraft (src/lib/highfives/generateDraft.ts).
 */
async function tryGenerate(
  userPrompt: string,
): Promise<Awaited<ReturnType<typeof resilientChatCompletion>> | null> {
  try {
    return await resilientChatCompletion(
      {
        model: OPENAI_VOICE_MODEL,
        messages: [
          { role: 'system', content: PARENT_NARRATIVE_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      },
      { timeoutMs: TIMEOUT_MS },
    );
  } catch (_e) {
    return null; // LlmExhaustedError / network / timeout → deterministic fallback
  }
}

/**
 * Parse raw JSON string, validate the shape (I2), validate every paragraph + starter
 * with parentLeaks, and apply the cold-start direction-word gate (I4).
 * Returns null on ANY failure — never throws, never iterates an undefined array.
 */
function parseAndValidate(
  raw: string,
  isColdStart: boolean,
): { paragraphs: string[]; conversation_starters: string[] } | null {
  // I2: safe JSON parse — catches malformed JSON without a TypeError escaping
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return null;
  }

  // I2: shape guard — require paragraphs[] (non-empty, all strings) + conversation_starters[]
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).paragraphs) ||
    ((parsed as Record<string, unknown>).paragraphs as unknown[]).length === 0 ||
    !((parsed as Record<string, unknown>).paragraphs as unknown[]).every(
      (p) => typeof p === 'string',
    ) ||
    !Array.isArray((parsed as Record<string, unknown>).conversation_starters) ||
    ((parsed as Record<string, unknown>).conversation_starters as unknown[]).length === 0 ||
    !((parsed as Record<string, unknown>).conversation_starters as unknown[]).every(
      (s) => typeof s === 'string',
    )
  ) {
    return null; // shape failure → fallback (never iterate undefined)
  }

  const paragraphs = (parsed as Record<string, unknown>).paragraphs as string[];
  const conversation_starters = (
    parsed as Record<string, unknown>
  ).conversation_starters as string[];

  // Validate every paragraph with parentLeaks
  for (const p of paragraphs) {
    if (parentLeaks(p).length > 0) return null;
  }
  // Validate every starter with parentLeaks
  for (const s of conversation_starters) {
    if (parentLeaks(s).length > 0) return null;
  }

  // I4: cold-start post-check — reject any paragraph with a fabricated direction word
  if (isColdStart) {
    for (const p of paragraphs) {
      if (COLD_START_DIRECTION_RE.test(p)) return null;
    }
  }

  return { paragraphs, conversation_starters };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate a parent Learning Summary from a ParentContext.
 *
 * NEVER throws. Returns:
 *   - source:'ai'       — clean on first pass
 *   - source:'ai_retry' — clean after one retry with stricter suffix
 *   - source:'fallback' — deterministic hard-coded text (AI down, leak violation, shape error)
 */
export async function generateParentNarrative(
  ctx: ParentContext,
): Promise<ParentNarrativeResult> {
  const isColdStart = ctx.gradeTrendDirection === null;
  const userPrompt = isColdStart
    ? parentNarrativeColdStartPrompt(ctx)
    : parentNarrativePrompt(ctx);

  // ── First attempt ──────────────────────────────────────────────────────────
  const firstCompletion = await tryGenerate(userPrompt);
  if (firstCompletion) {
    const raw = firstCompletion.choices[0]?.message?.content;
    if (raw?.trim()) {
      const validated = parseAndValidate(raw, isColdStart);
      if (validated) return { ...validated, source: 'ai' };
    }
  }

  // ── Retry with stricter suffix (I8) ───────────────────────────────────────
  const retryPrompt = userPrompt + PARENT_NARRATIVE_RETRY_SUFFIX;
  const secondCompletion = await tryGenerate(retryPrompt);
  if (secondCompletion) {
    const raw = secondCompletion.choices[0]?.message?.content;
    if (raw?.trim()) {
      const validated = parseAndValidate(raw, isColdStart);
      if (validated) return { ...validated, source: 'ai_retry' };
    }
  }

  // ── Deterministic fallback (M5) ────────────────────────────────────────────
  return buildFallback(ctx);
}
