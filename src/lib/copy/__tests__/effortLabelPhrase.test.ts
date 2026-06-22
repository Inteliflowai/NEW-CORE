import { describe, it, expect } from 'vitest';
import { effortLabelPhrase } from '@/lib/copy/effortLabelPhrase';
import { EFFORT_LABELS } from '@/lib/signals/computeEffortLabel';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';

describe('effortLabelPhrase', () => {
  it('maps each of the four real enum values to a non-empty phrase', () => {
    for (const label of EFFORT_LABELS) {
      const phrase = effortLabelPhrase(label);
      expect(phrase, label).toBeTruthy();
      expect(typeof phrase).toBe('string');
    }
  });
  it('returns null for a null label (ungraded — no phrase yet)', () => {
    expect(effortLabelPhrase(null)).toBeNull();
  });
  it('every phrase is number-free and banned-word-free (both guards)', () => {
    for (const label of EFFORT_LABELS) {
      const phrase = effortLabelPhrase(label)!;
      expect(hasLeak(phrase), `leak in ${label}: ${phrase}`).toBe(false);
      expect(hasBannedWord(phrase), `banned word in ${label}: ${phrase}`).toBe(false);
    }
  });
});
