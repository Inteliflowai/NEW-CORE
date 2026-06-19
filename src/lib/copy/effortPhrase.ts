// src/lib/copy/effortPhrase.ts
// Maps an effort_label enum value to audience-safe copy for teacher surfaces.
// Pure + import-safe (no Next.js / Supabase imports).

import { assertNoLeak } from './leakGuard';

/** The four known effort_label enum values. */
export type EffortLabel = 'low' | 'medium' | 'high' | 'inconsistent';

const EFFORT_COPY: Record<EffortLabel, string> = {
  low: 'Effort has been light on this topic — worth a nudge.',
  medium: 'Putting in a reasonable amount of work here.',
  high: 'Really leaning in — strong effort on this one.',
  inconsistent: 'Effort has been uneven; some days on, some days off.',
};

const FALLBACK = 'Effort information is not yet available.';

/**
 * Returns audience-safe copy for a given effort_label value.
 * null or unrecognised values return a neutral fallback.
 */
export function effortPhrase(label: EffortLabel | null | string): string {
  const copy =
    label !== null && label in EFFORT_COPY
      ? EFFORT_COPY[label as EffortLabel]
      : FALLBACK;

  assertNoLeak(copy, 'effortPhrase');
  return copy;
}
