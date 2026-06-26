// src/lib/copy/leakGuard.ts
// Guards against numeric / statistical leaks reaching four-audience copy surfaces.
// "Leak" = any raw digit, %, avg, score-N, ordinal/percentile, or rank word.
// Pure + import-safe (no Next.js / Supabase imports).

/**
 * Ordered list of patterns that constitute a "leak" in audience-safe copy.
 * Case-insensitive at call-site.
 */
export const LEAK_PATTERNS: RegExp[] = [
  /\d/,                          // any bare digit
  /%/,                           // percent sign
  /\bavg\b/i,                    // "avg"
  /\bscore\s+\d/i,               // "score <number>"
  /\d+(?:st|nd|rd|th)\b/i,       // ordinals: 2nd, 73rd, 1st …
  /\bpercentile\b/i,             // the word "percentile"
  /\brank(?:ed)?\b/i,            // "rank" or "ranked"
];

/**
 * Returns true if the text contains any numeric / statistical leak pattern.
 */
export function hasLeak(text: string): boolean {
  return LEAK_PATTERNS.some((re) => re.test(text));
}

/**
 * Throws if the text contains a leak.
 * Pass an optional `ctx` string (e.g. caller name) for clearer error messages.
 */
export function assertNoLeak(text: string, ctx?: string): void {
  if (hasLeak(text)) {
    const prefix = ctx ? `[${ctx}] ` : '';
    throw new Error(
      `${prefix}Audience-copy leak detected in: "${text}"`,
    );
  }
}

/**
 * COACH-POSTURE banned words — metric/engineering jargon never shown to users.
 * "risk" is intentionally NOT here (it appears in established teacher copy).
 */
export const BANNED_WORDS: readonly string[] = [
  'score', 'percentile', 'index', 'divergence', 'threshold',
  'signal', 'model', 'algorithm', 'flag',
];

const BANNED_WORD_RE = new RegExp(`\\b(?:${BANNED_WORDS.join('|')})\\b`, 'i');

/** True if the text contains a COACH-POSTURE banned word (whole-word, case-insensitive). */
export function hasBannedWord(text: string): boolean {
  return BANNED_WORD_RE.test(text);
}

/** Throws if the text contains a banned word. Optional `ctx` for clearer errors. */
export function assertNoBannedWord(text: string, ctx?: string): void {
  if (hasBannedWord(text)) {
    const prefix = ctx ? `[${ctx}] ` : '';
    throw new Error(`${prefix}Banned coach-posture word detected in: "${text}"`);
  }
}

// Diagnostic teacher-only vocabulary that must never reach a student/parent surface.
// (Mirrors assignmentResultBundle's DIAGNOSTIC_VOCAB_RE; this is the shared home.)
export const DIAGNOSTIC_VOCAB_RE =
  /\b(?:reteach|re-teach|reinforce|enrich|scaffolded|extension|partial mastery|strong mastery|(?:top|mid|low|high)-band|\bband\b|above grade level|grade level|on track)\b/i;

/** True if the text contains any diagnostic teacher-only level/verb/band term. */
export function hasDiagnosticVocab(text: string): boolean {
  return DIAGNOSTIC_VOCAB_RE.test(text);
}
