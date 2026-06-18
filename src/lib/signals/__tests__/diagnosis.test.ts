import { describe, it, expect } from 'vitest';
import { findRecurringError, diagnose, RECURRING_ERROR_THRESHOLD } from '../diagnosis';

describe('RECURRING_ERROR_THRESHOLD', () => {
  it('is 3', () => {
    expect(RECURRING_ERROR_THRESHOLD).toBe(3);
  });
});

describe('findRecurringError', () => {
  it('returns null when array is empty', () => {
    expect(findRecurringError([])).toBeNull();
  });

  it('returns null when no error reaches threshold', () => {
    // Two occurrences — below threshold of 3
    expect(findRecurringError(['reasoning_gap', 'reasoning_gap'])).toBeNull();
  });

  it('returns null when all entries are "none" or empty', () => {
    expect(findRecurringError(['none', 'none', 'none', '', 'none'])).toBeNull();
  });

  it('returns the error at exactly threshold (3)', () => {
    const result = findRecurringError(['reasoning_gap', 'reasoning_gap', 'reasoning_gap']);
    expect(result).toEqual({ type: 'reasoning_gap', count: 3 });
  });

  it('returns the most-frequent error above threshold', () => {
    const result = findRecurringError([
      'reasoning_gap', 'reasoning_gap', 'reasoning_gap', 'reasoning_gap',
      'incomplete', 'incomplete', 'incomplete',
    ]);
    expect(result).toEqual({ type: 'reasoning_gap', count: 4 });
  });

  it('respects a custom threshold', () => {
    expect(findRecurringError(['incomplete', 'incomplete'], 2)).toEqual({ type: 'incomplete', count: 2 });
    expect(findRecurringError(['incomplete', 'incomplete'], 3)).toBeNull();
  });

  it('ignores "none" entries even when frequent', () => {
    // 5x "none" must not be returned — it is not a real error category
    const result = findRecurringError(['none', 'none', 'none', 'none', 'none', 'reasoning_gap', 'reasoning_gap', 'reasoning_gap']);
    expect(result).toEqual({ type: 'reasoning_gap', count: 3 });
  });
});

describe('diagnose', () => {
  it('returns null when there is no actionable signal (below all thresholds)', () => {
    const result = diagnose({
      divergence_score: 10,
      hw_avg: 80,
      quiz_avg: 75,
      error_types: [],
    });
    expect(result).toBeNull();
  });

  it('first match: high divergence + low hw + OK quiz -> verbal_check', () => {
    // DIVERGENCE_THRESHOLD=25, LOW_HW=50, OK_QUIZ=60
    const result = diagnose({
      divergence_score: 30,
      hw_avg: 40,    // < LOW_HW (50)
      quiz_avg: 65,  // >= OK_QUIZ (60)
      error_types: [],
    });
    expect(result).not.toBeNull();
    expect(result!.suggestedAction).toBe('verbal_check');
    expect(result!.severity).toBeGreaterThanOrEqual(1);
  });

  it('first match: high divergence + low quiz -> reteach', () => {
    // DIVERGENCE_THRESHOLD=25, LOW_QUIZ=50
    const result = diagnose({
      divergence_score: 30,
      hw_avg: 80,
      quiz_avg: 40,  // < LOW_QUIZ (50)
      error_types: [],
    });
    expect(result).not.toBeNull();
    expect(result!.suggestedAction).toBe('reteach');
  });

  it('recurring error type -> check_concepts (practice)', () => {
    const result = diagnose({
      divergence_score: 5,  // below threshold
      hw_avg: 75,
      quiz_avg: 70,
      error_types: ['reasoning_gap', 'reasoning_gap', 'reasoning_gap'],
    });
    expect(result).not.toBeNull();
    expect(result!.suggestedAction).toBe('practice');
  });

  it('returns null when fine — divergence < threshold and no recurring errors', () => {
    const result = diagnose({
      divergence_score: 20,
      hw_avg: 72,
      quiz_avg: 68,
      error_types: ['reasoning_gap', 'reasoning_gap'], // only 2, below threshold
    });
    expect(result).toBeNull();
  });
});
