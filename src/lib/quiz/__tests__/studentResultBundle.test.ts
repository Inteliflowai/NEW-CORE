import { describe, it, expect } from 'vitest';
import { studentResultBundle } from '../studentResultBundle';
import { hasLeak } from '@/lib/copy/leakGuard';

describe('studentResultBundle', () => {
  it('returns a coaching message, a soft mastery label, and a study-guide flag', () => {
    const bundle = studentResultBundle({
      scorePct: 92,
      masteryBand: 'advanced',
      tier: 'middle',
      firstName: 'Alex',
      attemptId: 'att-1',
    });
    expect(typeof bundle.scoreMessage.message).toBe('string');
    expect(bundle.scoreMessage.message.length).toBeGreaterThan(0);
    // 'advanced' → 'Strong' (soft label, never the raw enum)
    expect(bundle.masteryLabel).toBe('Strong');
    expect(bundle.needsStudyGuide).toBe(false);
  });

  it('flags needsStudyGuide when scorePct < 80', () => {
    const bundle = studentResultBundle({
      scorePct: 42,
      masteryBand: 'reteach',
      tier: 'middle',
      firstName: 'Sam',
      attemptId: 'att-2',
    });
    expect(bundle.needsStudyGuide).toBe(true);
    expect(bundle.masteryLabel).toBe('Building'); // reteach → Building
  });

  it('does NOT flag needsStudyGuide at exactly 80', () => {
    const bundle = studentResultBundle({
      scorePct: 80,
      masteryBand: 'grade_level',
      tier: 'high',
      firstName: null,
      attemptId: 'att-3',
    });
    expect(bundle.needsStudyGuide).toBe(false);
    expect(bundle.masteryLabel).toBe('On Track'); // grade_level → On Track
  });

  it('null masteryBand → "Not yet assessed"', () => {
    const bundle = studentResultBundle({
      scorePct: 70,
      masteryBand: null,
      tier: 'elementary',
      firstName: 'Jo',
      attemptId: 'att-4',
    });
    expect(bundle.masteryLabel).toBe('Not yet assessed');
  });

  it('LEAK AUDIT: neither message nor label contains a digit, %, or raw band enum', () => {
    for (const band of ['reteach', 'grade_level', 'advanced', null]) {
      const bundle = studentResultBundle({
        scorePct: 55,
        masteryBand: band,
        tier: 'high',
        firstName: 'Pat',
        attemptId: `att-${band}`,
      });
      expect(hasLeak(bundle.scoreMessage.message)).toBe(false);
      expect(hasLeak(bundle.masteryLabel)).toBe(false);
      // never the raw enum
      expect(bundle.masteryLabel).not.toBe('reteach');
      expect(bundle.masteryLabel).not.toBe('grade_level');
      expect(bundle.masteryLabel).not.toBe('advanced');
    }
  });
});
