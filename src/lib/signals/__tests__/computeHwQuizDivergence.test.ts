import { describe, it, expect } from 'vitest';
import { computeHwQuizDivergence } from '../computeHwQuizDivergence';

describe('computeHwQuizDivergence', () => {
  it('returns aligned + score=0 when below MIN_HW_SAMPLES', () => {
    const result = computeHwQuizDivergence({
      homeworkScores: [80],       // only 1, need 2
      quizScores:     [80],
    });
    expect(result.divergence_direction).toBe('aligned');
    expect(result.divergence_score).toBe(0);
    expect(result.divergence_trend).toBeNull();
    expect(result.hw_avg).toBe(80);
    expect(result.quiz_avg).toBe(80);
  });

  it('returns aligned + score=0 when below MIN_QUIZ_SAMPLES', () => {
    const result = computeHwQuizDivergence({
      homeworkScores: [80, 90],
      quizScores:     [],         // 0 quiz scores, need 1
    });
    expect(result.divergence_direction).toBe('aligned');
    expect(result.divergence_score).toBe(0);
    expect(result.hw_avg).toBe(85);
    expect(result.quiz_avg).toBeNull();
  });

  it('gap=10 sits on the ALIGNMENT_THRESHOLD boundary → aligned', () => {
    // hw_avg=80, quiz_avg=70, gap=10 — exactly at threshold → aligned
    const result = computeHwQuizDivergence({
      homeworkScores: [80, 80],
      quizScores:     [70],
    });
    expect(result.divergence_direction).toBe('aligned');
    expect(result.divergence_score).toBe(10);
  });

  it('gap=11 → hw_higher, score=round(11/50*100)=22', () => {
    const result = computeHwQuizDivergence({
      homeworkScores: [80, 82],   // avg=81
      quizScores:     [70],       // avg=70, gap=11
    });
    expect(result.divergence_direction).toBe('hw_higher');
    expect(result.divergence_score).toBe(22);
  });

  it('quiz_higher when quiz_avg > hw_avg by >10', () => {
    const result = computeHwQuizDivergence({
      homeworkScores: [50, 50],
      quizScores:     [80],       // gap=-30 → quiz_higher, score=60
    });
    expect(result.divergence_direction).toBe('quiz_higher');
    expect(result.divergence_score).toBe(60);
  });

  it('gap=20 → score=40', () => {
    const result = computeHwQuizDivergence({
      homeworkScores: [80, 80],
      quizScores:     [60],
    });
    expect(result.divergence_score).toBe(40);
  });

  it('gap=25 → score=50', () => {
    const result = computeHwQuizDivergence({
      homeworkScores: [75, 75],
      quizScores:     [50],
    });
    expect(result.divergence_score).toBe(50);
  });

  it('gap=50 → score=100 (capped)', () => {
    const result = computeHwQuizDivergence({
      homeworkScores: [100, 100],
      quizScores:     [50],
    });
    expect(result.divergence_score).toBe(100);
  });

  it('gap>50 is capped at 100', () => {
    const result = computeHwQuizDivergence({
      homeworkScores: [100, 100],
      quizScores:     [0],
    });
    expect(result.divergence_score).toBe(100);
  });

  it('trend is null when fewer than 3 of either series', () => {
    const result = computeHwQuizDivergence({
      homeworkScores: [80, 90],
      quizScores:     [60],
    });
    expect(result.divergence_trend).toBeNull();
  });

  it('trend stable when gap magnitude barely changes', () => {
    // hw stable around 80, quiz stable around 60 — gap ~20 throughout
    const result = computeHwQuizDivergence({
      homeworkScores: [79, 80, 81],
      quizScores:     [59, 60, 61],
    });
    expect(result.divergence_trend).toBe('stable');
  });

  it('trend widening when gap grows over time (newest first)', () => {
    // newest first: gap at end=40, at start=10 (widening)
    const result = computeHwQuizDivergence({
      homeworkScores: [90, 75, 70],   // newest→oldest: 90,75,70
      quizScores:     [50, 65, 60],   // newest→oldest: 50,65,60
    });
    // chronological hw=[70,75,90] quiz=[60,65,50]
    // gaps=[10,10,40]; first-half=[10], second-half=[40] → widening
    expect(result.divergence_trend).toBe('widening');
  });

  it('trend narrowing when gap shrinks over time', () => {
    // newest first: hw=[70,75,90], quiz=[60,65,80]
    // chronological hw=[90,75,70] quiz=[80,65,60]
    // gaps=[10,10,10] → stable (narrow test with explicit narrowing)
    // Use a dataset where gap shrinks: chron hw=[90,80,70], quiz=[50,65,65]
    // gaps=[40,15,5]; first=[40], second=[5] → narrowing
    const result = computeHwQuizDivergence({
      homeworkScores: [70, 80, 90],   // newest first → chron reversed=[90,80,70]
      quizScores:     [65, 65, 50],   // newest first → chron reversed=[50,65,65]
    });
    expect(result.divergence_trend).toBe('narrowing');
  });

  it('filters out null scores', () => {
    const result = computeHwQuizDivergence({
      homeworkScores: [80, null, 80],
      quizScores:     [60, null],
    });
    expect(result.hw_avg).toBe(80);
    expect(result.quiz_avg).toBe(60);
  });
});
