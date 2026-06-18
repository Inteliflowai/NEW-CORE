// src/lib/utils/__tests__/masteryLabel.test.ts
// FIX 2 (B2): masteryDisplayLabel maps raw DB enum → soft student-facing word.
// SCOPE §15: never expose raw band enum ('reteach'/'grade_level'/'advanced') to students.

import { describe, it, expect } from 'vitest';
import { masteryDisplayLabel } from '@/lib/utils/masteryLabel';

describe('masteryDisplayLabel', () => {
  it("maps 'reteach' → 'Building'", () => {
    expect(masteryDisplayLabel('reteach')).toBe('Building');
  });

  it("maps 'grade_level' → 'On Track'", () => {
    expect(masteryDisplayLabel('grade_level')).toBe('On Track');
  });

  it("maps 'advanced' → 'Strong'", () => {
    expect(masteryDisplayLabel('advanced')).toBe('Strong');
  });

  it("maps null → 'Not yet assessed'", () => {
    expect(masteryDisplayLabel(null)).toBe('Not yet assessed');
  });

  it("maps undefined/unknown string → 'Not yet assessed'", () => {
    expect(masteryDisplayLabel('unknown_band')).toBe('Not yet assessed');
  });

  it("maps empty string → 'Not yet assessed'", () => {
    expect(masteryDisplayLabel('')).toBe('Not yet assessed');
  });

  // Confirm raw enum strings never leak through
  it('never returns the raw enum string for known values', () => {
    expect(masteryDisplayLabel('reteach')).not.toBe('reteach');
    expect(masteryDisplayLabel('grade_level')).not.toBe('grade_level');
    expect(masteryDisplayLabel('advanced')).not.toBe('advanced');
  });
});
