// src/lib/copy/__tests__/diagnosisToFeedSentence.test.ts
import { describe, it, expect } from 'vitest';
import { diagnosisToFeedSentence } from '../diagnosisToFeedSentence';
import { assertNoLeak } from '../leakGuard';

describe('diagnosisToFeedSentence', () => {
  it('produces a leak-free sentence per suggestedAction', () => {
    (
      ['reteach', 'practice', 'verbal_check', 'profile', 'monitor'] as const
    ).forEach((a) => {
      const s = diagnosisToFeedSentence({ suggestedAction: a, severity: 2 });
      expect(s.length).toBeGreaterThan(0);
      assertNoLeak(s); // no %, no avg numbers — the leak diagnose() introduces
    });
  });

  it('returns distinct sentences for each suggestedAction', () => {
    const actions = [
      'reteach',
      'practice',
      'verbal_check',
      'profile',
      'monitor',
    ] as const;
    const sentences = actions.map((a) =>
      diagnosisToFeedSentence({ suggestedAction: a, severity: 2 }),
    );
    expect(new Set(sentences).size).toBe(5);
  });

  it('all severity levels produce leak-free output', () => {
    ([1, 2, 3] as const).forEach((sev) => {
      const s = diagnosisToFeedSentence({
        suggestedAction: 'reteach',
        severity: sev,
      });
      expect(() => assertNoLeak(s)).not.toThrow();
    });
  });
});
