import { describe, it, expect } from 'vitest';
import { insightsObservation, bandPillLabel } from '@/lib/copy/insightsObservation';
import { hasBannedWord } from '@/lib/copy/leakGuard';

const mix = (p: Partial<{ r: number; o: number; e: number; n: number }>) => {
  const needs_reinforcement = p.r ?? 0, on_track = p.o ?? 0, ready_to_enrich = p.e ?? 0, not_assessed = p.n ?? 0;
  return { needs_reinforcement, on_track, ready_to_enrich, not_assessed, total: needs_reinforcement + on_track + ready_to_enrich + not_assessed };
};

describe('insightsObservation', () => {
  it('flags a class-wide reteach when reinforcement is >= 40% of assessed', () => {
    const line = insightsObservation(mix({ r: 5, o: 4, e: 1 })); // 5/10 = 50%
    expect(line).toMatch(/re-?teach/i);
    expect(hasBannedWord(line!)).toBe(false);
  });
  it('suggests enrichment when ready-to-enrich is a majority', () => {
    expect(insightsObservation(mix({ e: 6, o: 3, r: 1 }))).toMatch(/deeper|enrich/i);
  });
  it('is quiet (null) when nothing is notable', () => {
    expect(insightsObservation(mix({ o: 10 }))).toBeNull();
  });
  it('is quiet (null) on an empty/cold-start class', () => {
    expect(insightsObservation(mix({ n: 8 }))).toBeNull();
  });
});

describe('bandPillLabel', () => {
  it('uses plain, banned-word-free labels', () => {
    for (const k of ['needs_reinforcement','on_track','ready_to_enrich','not_assessed'] as const) {
      expect(hasBannedWord(bandPillLabel(k))).toBe(false);
    }
  });
});
