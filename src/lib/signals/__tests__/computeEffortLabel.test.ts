import { describe, it, expect } from 'vitest';
import {
  computeEffortLabel,
  SUCCESS_THRESHOLD,
  EFFORT_THRESHOLD,
  EFFORT_LABELS,
  STRUGGLING_LABELS,
} from '../computeEffortLabel';

describe('computeEffortLabel', () => {
  // ── Exported constants ──────────────────────────────────
  it('exports SUCCESS_THRESHOLD=75', () => {
    expect(SUCCESS_THRESHOLD).toBe(75);
  });

  it('exports EFFORT_THRESHOLD=2', () => {
    expect(EFFORT_THRESHOLD).toBe(2);
  });

  it('EFFORT_LABELS contains all 4 values', () => {
    expect(EFFORT_LABELS).toContain('effortful_success');
    expect(EFFORT_LABELS).toContain('struggling_trying');
    expect(EFFORT_LABELS).toContain('independent_success');
    expect(EFFORT_LABELS).toContain('independent_struggle');
    expect(EFFORT_LABELS).toHaveLength(4);
  });

  it('STRUGGLING_LABELS contains struggling_trying and independent_struggle', () => {
    expect(STRUGGLING_LABELS).toContain('struggling_trying');
    expect(STRUGGLING_LABELS).toContain('independent_struggle');
    expect(STRUGGLING_LABELS).toHaveLength(2);
  });

  // ── null / undefined score ───────────────────────────────
  it('returns null when score is null', () => {
    expect(computeEffortLabel({ score: null, teliHintCount: 5 })).toBeNull();
  });

  it('returns null when score is undefined', () => {
    expect(computeEffortLabel({ score: undefined, teliHintCount: 3 })).toBeNull();
  });

  // ── 2×2 matrix (Quadrant 1–4) ────────────────────────────
  // Q1: success=true, effortful=true → effortful_success
  it('Q1: score≥75 AND hints≥2 → effortful_success', () => {
    expect(computeEffortLabel({ score: 75, teliHintCount: 2 })).toBe('effortful_success');
  });

  it('Q1: score=100 AND hints=5 → effortful_success', () => {
    expect(computeEffortLabel({ score: 100, teliHintCount: 5 })).toBe('effortful_success');
  });

  // Q2: success=false, effortful=true → struggling_trying
  it('Q2: score<75 AND hints≥2 → struggling_trying', () => {
    expect(computeEffortLabel({ score: 74, teliHintCount: 2 })).toBe('struggling_trying');
  });

  it('Q2: score=0 AND hints=10 → struggling_trying', () => {
    expect(computeEffortLabel({ score: 0, teliHintCount: 10 })).toBe('struggling_trying');
  });

  // Q3: success=true, effortful=false → independent_success
  it('Q3: score≥75 AND hints<2 → independent_success', () => {
    expect(computeEffortLabel({ score: 75, teliHintCount: 1 })).toBe('independent_success');
  });

  it('Q3: score=90 AND hints=0 → independent_success', () => {
    expect(computeEffortLabel({ score: 90, teliHintCount: 0 })).toBe('independent_success');
  });

  it('Q3: score=80 AND teliHintCount=null → treated as 0 → independent_success', () => {
    expect(computeEffortLabel({ score: 80, teliHintCount: null })).toBe('independent_success');
  });

  // Q4: success=false, effortful=false → independent_struggle
  it('Q4: score<75 AND hints<2 → independent_struggle', () => {
    expect(computeEffortLabel({ score: 74, teliHintCount: 1 })).toBe('independent_struggle');
  });

  it('Q4: score=0 AND hints=0 → independent_struggle', () => {
    expect(computeEffortLabel({ score: 0, teliHintCount: 0 })).toBe('independent_struggle');
  });

  it('Q4: score=74 AND teliHintCount=undefined → treated as 0 → independent_struggle', () => {
    expect(computeEffortLabel({ score: 74, teliHintCount: undefined })).toBe('independent_struggle');
  });

  // ── Threshold boundary precision ────────────────────────
  it('score=74.9 is below SUCCESS_THRESHOLD → struggle quadrant', () => {
    expect(computeEffortLabel({ score: 74.9, teliHintCount: 0 })).toBe('independent_struggle');
  });

  it('hints=1 is below EFFORT_THRESHOLD → independent quadrant', () => {
    expect(computeEffortLabel({ score: 100, teliHintCount: 1 })).toBe('independent_success');
  });
});
