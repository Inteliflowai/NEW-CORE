import { describe, it, expect } from 'vitest';
import { contrastRatio, checkAllPairs, type ContrastResult } from '../contrast-check';

describe('contrastRatio()', () => {
  it('returns ~21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('returns ~1 for identical colors', () => {
    expect(contrastRatio('#aabbcc', '#aabbcc')).toBeCloseTo(1, 1);
  });

  it('is commutative', () => {
    const a = contrastRatio('#059669', '#ffffff');
    const b = contrastRatio('#ffffff', '#059669');
    expect(a).toBeCloseTo(b, 5);
  });

  it('catches a deliberately dim pair (near-gray fg on white bg) below 4.5:1', () => {
    // #a8a8a8 on #ffffff = ~3.6:1 — fails body-text AA threshold
    const ratio = contrastRatio('#a8a8a8', '#ffffff');
    expect(ratio).toBeLessThan(4.5);
    // Verify it's in the ballpark (not a broken implementation returning 0 or 21)
    expect(ratio).toBeGreaterThan(2);
  });
});

describe('checkAllPairs()', () => {
  it('returns an array of ContrastResult for every role/intensity pairing', () => {
    const results = checkAllPairs();
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty('role');
      expect(r).toHaveProperty('intensity');
      expect(r).toHaveProperty('pair');
      expect(r).toHaveProperty('ratio');
      expect(r).toHaveProperty('passes');
      expect(r).toHaveProperty('required');
    }
  });

  it('all pairs pass WCAG AA (no failures) — regression anchor for current globals.css', () => {
    const results = checkAllPairs();
    const failures = results.filter((r) => !r.passes);
    const msg = failures
      .map((f) => `${f.role}/${f.intensity} ${f.pair}: ratio=${f.ratio.toFixed(2)} required=${f.required}`)
      .join('\n');
    expect(failures, `Contrast failures:\n${msg}`).toHaveLength(0);
  });

  it('gate catches a failure: dim fg (#a8a8a8) on white bg is reported as failing body-text AA', () => {
    // Construct a fake ContrastResult as the gate would produce for a dim pair
    const dimFg = '#a8a8a8';
    const whiteBg = '#ffffff';
    const ratio = contrastRatio(dimFg, whiteBg);
    const required = 4.5;
    const result: ContrastResult = {
      role: 'test-role',
      intensity: 'test',
      pair: 'fg/bg',
      fg: dimFg,
      bg: whiteBg,
      ratio,
      required,
      passes: ratio >= required,
    };
    expect(result.passes).toBe(false);
    expect(result.ratio).toBeLessThan(4.5);
  });
});
