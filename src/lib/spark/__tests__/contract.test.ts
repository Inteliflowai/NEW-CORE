import { describe, it, expect } from 'vitest';
import { bandToSparkBand, gradeToBand, computeTransferScore, transferWord } from '../contract';

describe('bandToSparkBand', () => {
  it('maps CORE bands to SPARK bands', () => {
    expect(bandToSparkBand('advanced')).toBe('mastery');
    expect(bandToSparkBand('grade_level')).toBe('developing');
    expect(bandToSparkBand('reteach')).toBe('struggling');
  });
});

describe('gradeToBand', () => {
  it('maps grades 3-12 into bands; null for K-2 / unparseable', () => {
    expect(gradeToBand('4')).toBe('3-5');
    expect(gradeToBand('Grade 7')).toBe('6-8');
    expect(gradeToBand(11)).toBe('9-12');
    expect(gradeToBand('2')).toBeNull();      // K-2 rejected by SPARK
    expect(gradeToBand('K')).toBeNull();
    expect(gradeToBand(null)).toBeNull();
  });
});

describe('computeTransferScore', () => {
  it('averages non-null rubric dims × 25', () => {
    // avg(4,4,3,4,3,3) = 3.5 → ×25 = 87.5 → round 88
    expect(
      computeTransferScore(
        { problem_understanding: 4, reasoning_strategy: 4, use_of_evidence: 3, creativity_application: 4, communication: 3, reflection_metacognition: 3, collaboration: null },
        null,
      ),
    ).toBe(88);
  });
  it('falls back to score when rubric absent/empty', () => {
    expect(computeTransferScore(null, 72)).toBe(72);
    expect(computeTransferScore({ collaboration: null }, 64)).toBe(64);
  });
  it('returns null when neither rubric nor score is usable', () => {
    expect(computeTransferScore(null, null)).toBeNull();
  });
});

describe('transferWord', () => {
  it('words the transfer score on SPARK thresholds (70 strong, 50 developing)', () => {
    expect(transferWord(88)).toBe('strong');
    expect(transferWord(60)).toBe('developing');
    expect(transferWord(30)).toBe('emerging');
    expect(transferWord(null)).toBe('not yet scored');
  });
});
