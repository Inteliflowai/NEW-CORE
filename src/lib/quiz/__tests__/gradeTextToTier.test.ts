// src/lib/quiz/__tests__/gradeTextToTier.test.ts
// Unit tests for the shared gradeTextToTier helper.
import { describe, it, expect } from 'vitest';
import { gradeTextToTier } from '@/lib/quiz/gradeTextToTier';

describe('gradeTextToTier', () => {
  it("maps '3' to elementary", () => {
    expect(gradeTextToTier('3')).toBe('elementary');
  });

  it("maps '7' to middle", () => {
    expect(gradeTextToTier('7')).toBe('middle');
  });

  it("maps '11' to high", () => {
    expect(gradeTextToTier('11')).toBe('high');
  });

  it("maps 'Grade 7' to middle (leading digits extracted)", () => {
    expect(gradeTextToTier('Grade 7')).toBe('middle');
  });

  it('maps null to middle', () => {
    expect(gradeTextToTier(null)).toBe('middle');
  });

  it("maps 'K' to middle (unparseable non-numeric)", () => {
    expect(gradeTextToTier('K')).toBe('middle');
  });
});
