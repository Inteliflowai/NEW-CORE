// src/lib/quiz/__tests__/scoreMessage.test.ts
// TDD: write tests before implementation.
// Default vitest env is node — no jsdom needed (module is framework-agnostic).

import { describe, it, expect } from 'vitest';
import {
  getScoreMessage,
  pickVariantStable,
  applyName,
  SCORE_VARIANTS_EN_BY_TIER,
  SCORE_VARIANTS_PT,
} from '../scoreMessage';
import { hasLeak } from '../../copy/leakGuard';

// ── 1. getScoreMessage returns well-formed objects ────────────────────────────

describe('getScoreMessage', () => {
  const cases: Array<{ pct: number; tier: 'elementary' | 'middle' | 'high'; locale: 'en' | 'pt'; expectedTeliState: string }> = [
    { pct: 95, tier: 'high',        locale: 'en', expectedTeliState: 'celebrating' },
    { pct: 92, tier: 'middle',      locale: 'en', expectedTeliState: 'celebrating' },
    { pct: 90, tier: 'elementary',  locale: 'en', expectedTeliState: 'celebrating' },
    { pct: 80, tier: 'high',        locale: 'en', expectedTeliState: 'idle'        },
    { pct: 75, tier: 'middle',      locale: 'en', expectedTeliState: 'idle'        },
    { pct: 65, tier: 'elementary',  locale: 'en', expectedTeliState: 'speaking'    },
    { pct: 60, tier: 'high',        locale: 'en', expectedTeliState: 'speaking'    },
    { pct: 45, tier: 'middle',      locale: 'en', expectedTeliState: 'speaking'    },
    { pct: 95, tier: 'high',        locale: 'pt', expectedTeliState: 'celebrating' },
    { pct: 80, tier: 'middle',      locale: 'pt', expectedTeliState: 'idle'        },
    { pct: 65, tier: 'elementary',  locale: 'pt', expectedTeliState: 'speaking'    },
    { pct: 30, tier: 'high',        locale: 'pt', expectedTeliState: 'speaking'    },
  ];

  it.each(cases)(
    'pct=$pct tier=$tier locale=$locale → teliState=$expectedTeliState',
    ({ pct, tier, locale, expectedTeliState }) => {
      const result = getScoreMessage(pct, 'test-seed-abc', locale, tier, 'Ana');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('teliMsg');
      expect(result).toHaveProperty('teliState');
      expect(typeof result.message).toBe('string');
      expect(typeof result.teliMsg).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.teliMsg.length).toBeGreaterThan(0);
      expect(result.teliState).toBe(expectedTeliState);
    },
  );

  it('band boundaries: pct=89 → strong (idle), pct=74 → effort (speaking), pct=59 → tough (speaking)', () => {
    const strong = getScoreMessage(89, 'seed', 'en', 'high', 'Sam');
    expect(strong.teliState).toBe('idle');

    const effort = getScoreMessage(74, 'seed', 'en', 'high', 'Sam');
    expect(effort.teliState).toBe('speaking');

    const tough = getScoreMessage(59, 'seed', 'en', 'high', 'Sam');
    expect(tough.teliState).toBe('speaking');
  });

  it('null firstName omits the name placeholder cleanly — no stray {name} remains', () => {
    const result = getScoreMessage(95, 'seed', 'en', 'middle', null);
    expect(result.message).not.toContain('{name}');
    expect(result.teliMsg).not.toContain('{name}');
    // should not start with a lowercase letter after removal
    const firstChar = result.message[0];
    if (firstChar !== undefined) {
      expect(firstChar).toMatch(/[A-Z\W]/);
    }
  });
});

// ── 2. applyName ─────────────────────────────────────────────────────────────

describe('applyName', () => {
  const baseVariant = {
    message: '{name}, you crushed it! 🌟',
    teliMsg: '{name}, you crushed it. I barely had to help.',
    teliState: 'celebrating' as const,
  };

  it('substitutes {name} with the given first name', () => {
    const result = applyName(baseVariant, 'Lena');
    expect(result.message).toBe('Lena, you crushed it! 🌟');
    expect(result.teliMsg).toBe('Lena, you crushed it. I barely had to help.');
  });

  it('drops {name} and following comma+space when empty string given', () => {
    const result = applyName(baseVariant, '');
    expect(result.message).not.toContain('{name}');
    // Should capitalize first letter
    expect(result.message[0]).toMatch(/[A-Z]/);
  });

  it('handles variant without {name} unchanged', () => {
    const noName = { message: 'Nailed it.', teliMsg: 'Tight work.', teliState: 'celebrating' as const };
    expect(applyName(noName, 'Sam')).toEqual(noName);
    expect(applyName(noName, '')).toEqual(noName);
  });

  it('{name} in middle of sentence is dropped cleanly when name is empty', () => {
    const midVariant = {
      message: 'Hey {name}, hard quiz!',
      teliMsg: 'Hey {name}, hard quiz.',
      teliState: 'speaking' as const,
    };
    const result = applyName(midVariant, '');
    expect(result.message).not.toContain('{name}');
    expect(result.teliMsg).not.toContain('{name}');
  });
});

// ── 3. pickVariantStable — deterministic for fixed seed ──────────────────────

describe('pickVariantStable', () => {
  const pool = SCORE_VARIANTS_EN_BY_TIER.high.celebrating;

  it('returns the same variant for the same seed', () => {
    const a = pickVariantStable(pool, 'fixed-seed-xyz');
    const b = pickVariantStable(pool, 'fixed-seed-xyz');
    expect(a).toEqual(b);
  });

  it('returns different variants for different seeds (probabilistic — usually differs)', () => {
    const results = new Set(
      ['seed-a', 'seed-b', 'seed-c', 'seed-d', 'seed-e', 'seed-f', 'seed-g', 'seed-h'].map(
        (s) => pickVariantStable(pool, s).message,
      ),
    );
    // With 8 different seeds against a 4-item pool, we should see more than 1 unique result
    expect(results.size).toBeGreaterThan(1);
  });

  it('handles a single-item pool without throwing', () => {
    const single = [pool[0]];
    expect(() => pickVariantStable(single, 'any-seed')).not.toThrow();
    expect(pickVariantStable(single, 'any-seed')).toEqual(single[0]);
  });
});

// ── 4. Leak audit — EVERY variant in BOTH pools ──────────────────────────────

describe('Leak audit (Option-D): no numeric/statistical leaks in any variant', () => {
  // EN tier-aware pool
  const tiers = ['elementary', 'middle', 'high'] as const;
  const bands = ['celebrating', 'strong', 'effort', 'tough'] as const;

  let enCount = 0;
  for (const tier of tiers) {
    for (const band of bands) {
      const variants = SCORE_VARIANTS_EN_BY_TIER[tier][band];
      for (const v of variants) {
        enCount++;
        it(`EN [${tier}][${band}] message="${v.message.slice(0, 40)}…" passes hasLeak`, () => {
          expect(hasLeak(v.message)).toBe(false);
        });
        it(`EN [${tier}][${band}] teliMsg="${v.teliMsg.slice(0, 40)}…" passes hasLeak`, () => {
          expect(hasLeak(v.teliMsg)).toBe(false);
        });
      }
    }
  }

  // PT pool
  let ptCount = 0;
  for (const band of bands) {
    const variants = SCORE_VARIANTS_PT[band];
    for (const v of variants) {
      ptCount++;
      it(`PT [${band}] message="${v.message.slice(0, 40)}…" passes hasLeak`, () => {
        expect(hasLeak(v.message)).toBe(false);
      });
      it(`PT [${band}] teliMsg="${v.teliMsg.slice(0, 40)}…" passes hasLeak`, () => {
        expect(hasLeak(v.teliMsg)).toBe(false);
      });
    }
  }

  // Summary assertion: confirm pool sizes are what we expect
  it('EN pool has exactly 48 variants (3 tiers × 4 bands × 4 variants each)', () => {
    let total = 0;
    for (const tier of tiers) {
      for (const band of bands) {
        total += SCORE_VARIANTS_EN_BY_TIER[tier][band].length;
      }
    }
    expect(total).toBe(48);
  });

  it('PT pool has exactly 40 variants (4 bands × 10 variants each)', () => {
    let total = 0;
    for (const band of bands) {
      total += SCORE_VARIANTS_PT[band].length;
    }
    expect(total).toBe(40);
  });
});
