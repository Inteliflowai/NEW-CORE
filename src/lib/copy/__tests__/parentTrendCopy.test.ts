import { describe, it, expect } from 'vitest';
import { parentTrendLead } from '@/lib/copy/parentTrendCopy';
import { hasLeak, hasBannedWord, hasDiagnosticVocab } from '@/lib/copy/leakGuard';
import { hasParentLeak } from '@/lib/copy/parentGuard';

const DIRECTIONS = ['climbing', 'steady', 'sliding', null] as const;

describe('parentTrendLead', () => {
  it('returns a non-empty sentence for every direction', () => {
    for (const d of DIRECTIONS) {
      expect(parentTrendLead(d).length).toBeGreaterThan(0);
    }
  });

  it('never leaks a digit, banned word, diagnostic verb, or parent-forbidden phrase', () => {
    for (const d of DIRECTIONS) {
      const s = parentTrendLead(d);
      expect(hasLeak(s)).toBe(false);
      expect(hasBannedWord(s)).toBe(false);
      expect(hasDiagnosticVocab(s)).toBe(false);
      expect(hasParentLeak(s)).toBe(false);
    }
  });

  it('gives a distinct cold-start line for null', () => {
    expect(parentTrendLead(null)).not.toBe(parentTrendLead('steady'));
  });
});
