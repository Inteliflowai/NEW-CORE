// src/lib/copy/misconceptionPhrase.ts
// Humanizes a recurring error_type into a teacher-safe sentence.
// NEVER prints a raw skill_id (the signature only takes { type, count }), and
// NEVER prints the count — words only, so it passes assertNoLeak.
// Pure + import-safe.

import { assertNoLeak } from './leakGuard';

export interface RecurringErrorInput {
  type: string;
  count: number;
}

// Known error_type → readable phrase. Anything unmapped is humanized generically.
const KNOWN: Record<string, string> = {
  sign_error: 'a recurring sign error keeps cropping up',
  sign_errors: 'a recurring sign error keeps cropping up',
  misplaced_decimal: 'the decimal point keeps landing in the wrong place',
  decimal_error: 'the decimal point keeps landing in the wrong place',
  order_of_operations: 'the order of operations keeps tripping them up',
  unit_conversion: 'unit conversions keep going astray',
  fraction_error: 'fractions keep getting handled the wrong way',
  place_value: 'place value keeps getting mixed up',
  carrying_error: 'carrying keeps getting dropped',
  borrowing_error: 'borrowing keeps getting dropped',
};

/**
 * Turns "sign_error" → "a recurring sign error keeps cropping up".
 * Unknown types are de-snaked into "<words> keeps coming up" so no raw token leaks.
 */
export function misconceptionPhrase(err: RecurringErrorInput): string {
  const key = (err.type ?? '').trim().toLowerCase();

  if (!key) {
    const fallback = 'A recurring mix-up keeps coming up here.';
    assertNoLeak(fallback, 'misconceptionPhrase');
    return fallback;
  }

  if (KNOWN[key]) {
    const sentence = capitalize(`${KNOWN[key]}.`);
    assertNoLeak(sentence, 'misconceptionPhrase');
    return sentence;
  }

  const words = key.replace(/_/g, ' ').trim();
  const sentence = capitalize(`a recurring ${words} keeps coming up.`);
  assertNoLeak(sentence, 'misconceptionPhrase');
  return sentence;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
