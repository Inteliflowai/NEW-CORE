// src/lib/copy/effortLabelPhrase.ts
// Teacher-safe coach-posture phrase for a homework attempt's effort_label.
// Keyed on the REAL four computeEffortLabel enum values (NOT effortPhrase.ts, which
// keys on a different 'low|medium|high|inconsistent' enum and never matches the stored value).
// DRAFT copy → Barb (STRINGS-FOR-BARB.md). Phrases are number-free → both guards run.
import { type EffortLabel } from '@/lib/signals/computeEffortLabel';
import { assertNoLeak, assertNoBannedWord } from '@/lib/copy/leakGuard';

const PHRASES: Record<EffortLabel, string> = {
  effortful_success: 'Worked hard and got there.',
  struggling_trying: 'Putting in real effort while wrestling with this.',
  independent_success: 'Handled this comfortably on their own.',
  independent_struggle: 'Struggled here without reaching for help yet.',
};

export function effortLabelPhrase(label: EffortLabel | null): string | null {
  if (label === null) return null;
  const phrase = PHRASES[label];
  if (!phrase) return null;
  assertNoLeak(phrase, 'effortLabelPhrase');
  assertNoBannedWord(phrase, 'effortLabelPhrase');
  return phrase;
}
