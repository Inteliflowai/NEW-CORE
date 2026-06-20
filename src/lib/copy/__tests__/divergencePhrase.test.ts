import { describe, it, expect } from 'vitest';
import { divergencePhrase } from '../divergencePhrase';

// divergencePhrase is TEACHER-ONLY and intentionally carries the assignment/quiz
// numbers (like triageWhySentence) — so NO assertNoLeak here.

describe('divergencePhrase', () => {
  it('says "Assignment", never "HW" or "Homework"', () => {
    const out = divergencePhrase({
      divergence_score: 30,
      divergence_direction: 'hw_higher',
      divergence_trend: 'widening',
      hw_avg: 82,
      quiz_avg: 52,
      divergence_flagged: true,
    });
    expect(out).toMatch(/assignment/i);
    expect(out).not.toMatch(/\bHW\b/);
    expect(out).not.toMatch(/homework/i);
  });

  it('carries the assignment + quiz numbers when present (teacher-only by design)', () => {
    const out = divergencePhrase({
      divergence_score: 30,
      divergence_direction: 'hw_higher',
      divergence_trend: 'widening',
      hw_avg: 82,
      quiz_avg: 52,
      divergence_flagged: true,
    });
    expect(out).toContain('82');
    expect(out).toContain('52');
  });

  it('distinguishes hw_higher (knows more than the work shows) from quiz_higher', () => {
    const hwHigher = divergencePhrase({
      divergence_score: 30,
      divergence_direction: 'hw_higher',
      divergence_trend: 'stable',
      hw_avg: 80,
      quiz_avg: 50,
      divergence_flagged: true,
    });
    const quizHigher = divergencePhrase({
      divergence_score: 30,
      divergence_direction: 'quiz_higher',
      divergence_trend: 'stable',
      hw_avg: 50,
      quiz_avg: 80,
      divergence_flagged: true,
    });
    expect(hwHigher).not.toBe(quizHigher);
  });

  it('returns a non-empty string even when averages are null', () => {
    const out = divergencePhrase({
      divergence_score: 25,
      divergence_direction: 'aligned',
      divergence_trend: null,
      hw_avg: null,
      quiz_avg: null,
      divergence_flagged: true,
    });
    expect(out.length).toBeGreaterThan(0);
  });
});
