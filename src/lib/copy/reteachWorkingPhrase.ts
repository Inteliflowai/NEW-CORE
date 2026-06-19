// src/lib/copy/reteachWorkingPhrase.ts
// Maps a last_reteach_outcome (free text) to soft "working / keep going" copy.
// Never outputs "%" or the word "failed".
// Pure + import-safe (no Next.js / Supabase imports).

import { assertNoLeak } from './leakGuard';

const WORKING_COPY = 'The reteach is paying off — keep going.';
const FALLBACK = 'More time with this concept will help.';

/**
 * Returns soft, audience-safe copy for a reteach outcome.
 *
 * Any non-null outcome is treated as "there was a reteach attempt"
 * and gets encouraging copy.  null gets a safe neutral fallback.
 */
export function reteachWorkingPhrase(outcome: string | null): string {
  const copy = outcome !== null ? WORKING_COPY : FALLBACK;
  assertNoLeak(copy, 'reteachWorkingPhrase');
  return copy;
}
