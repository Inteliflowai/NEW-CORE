// src/lib/copy/pctIncorrectToWords.ts
// Converts a proportion incorrect (0–1 or 0–100) to soft audience-safe words.
// SCOPE: teacher/admin surfaces must never display raw percentages.
// Pure + import-safe (no Next.js / Supabase imports).

import { assertNoLeak } from './leakGuard';

/**
 * Maps a proportion-incorrect value to soft words with no digits.
 *
 * Accepts 0–1 (proportion) or 0–100 (percentage) — values ≥ 1 are normalised by /100.
 *
 * Buckets (after normalisation to 0–1):
 *   < 0.10  → "almost none"
 *   < 0.20  → "a few"
 *   < 0.35  → "about a quarter"
 *   < 0.60  → "about half"
 *   < 0.80  → "most"
 *   ≥ 0.80  → "nearly all"
 */
export function pctIncorrectToWords(value: number): string {
  const p = value >= 1 ? value / 100 : value;

  let phrase: string;
  if (p < 0.1) {
    phrase = 'almost none';
  } else if (p < 0.2) {
    phrase = 'a few';
  } else if (p < 0.35) {
    phrase = 'about a quarter';
  } else if (p < 0.6) {
    phrase = 'about half';
  } else if (p < 0.8) {
    phrase = 'most';
  } else {
    phrase = 'nearly all';
  }

  assertNoLeak(phrase, 'pctIncorrectToWords');
  return phrase;
}
