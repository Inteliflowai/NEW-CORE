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
