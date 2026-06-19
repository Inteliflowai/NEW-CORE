// src/lib/copy/__tests__/narrativeRank.test.ts
import { describe, it, expect } from 'vitest';
import { narrativeRank } from '../narrativeRank';

describe('narrativeRank', () => {
  it('orders severity-first', () => {
    const items = [{ severity: 1 }, { severity: 3 }, { severity: 2 }];
    expect(
      [...items]
        .sort((a, b) => narrativeRank(b) - narrativeRank(a))
        .map((i) => i.severity),
    ).toEqual([3, 2, 1]);
  });

  it('breaks ties deterministically by recency then action', () => {
    // equal severity -> more recent (smaller recencyDays) ranks higher
    const a = { severity: 2, recencyDays: 1, action: 'reteach' };
    const b = { severity: 2, recencyDays: 9, action: 'reteach' };
    expect(narrativeRank(a)).toBeGreaterThan(narrativeRank(b));

    // same severity + same recencyDays, different action → never ties
    const c = { severity: 2, recencyDays: 1, action: 'monitor' };
    expect(narrativeRank(a)).not.toBe(narrativeRank(c));
  });

  it('is deterministic (same input → same output)', () => {
    const input = { severity: 3, recencyDays: 5, action: 'practice' };
    expect(narrativeRank(input)).toBe(narrativeRank(input));
  });

  it('handles missing optional fields gracefully', () => {
    const rank = narrativeRank({ severity: 1 });
    expect(typeof rank).toBe('number');
    expect(isNaN(rank)).toBe(false);
  });
});
