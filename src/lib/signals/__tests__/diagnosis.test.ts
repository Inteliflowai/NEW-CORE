import { describe, it, expect } from 'vitest';
import { findRecurringError, diagnose, RECURRING_ERROR_THRESHOLD, SURFACING_THRESHOLD } from '../diagnosis';

describe('RECURRING_ERROR_THRESHOLD', () => {
  it('is 3', () => {
    expect(RECURRING_ERROR_THRESHOLD).toBe(3);
  });
});

describe('SURFACING_THRESHOLD', () => {
  it('is 20', () => {
    expect(SURFACING_THRESHOLD).toBe(20);
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

  // FIX 1 (a2): gap-10 must NOT surface (below SURFACING_THRESHOLD=20)
  it('FIX1: divergence_score=10 returns null (below surfacing floor)', () => {
    const result = diagnose({
      divergence_score: 10,
      hw_avg: 72,
      quiz_avg: 68,
      error_types: [],
    });
    expect(result).toBeNull();
  });

  // FIX 1 (a2): gap-19 must NOT surface (just below SURFACING_THRESHOLD=20)
  it('FIX1: divergence_score=19 returns null (just below surfacing floor)', () => {
    const result = diagnose({
      divergence_score: 19,
      hw_avg: 72,
      quiz_avg: 68,
      error_types: [],
    });
    expect(result).toBeNull();
  });

  // FIX 1 (a2): gap-22 MUST surface as low-severity monitor tier
  it('FIX1: divergence_score=22 surfaces as low-severity monitor tier (not null)', () => {
    const result = diagnose({
      divergence_score: 22,
      hw_avg: 72,
      quiz_avg: 68,
      error_types: [],
    });
    expect(result).not.toBeNull();
    expect(result!.severity).toBe(1);
    expect(result!.suggestedAction).toBe('monitor');
    // Diagnosis text must mention the gap score
    expect(result!.diagnosis).toContain('22');
  });

  // FIX 1 (a2): gap-27 MUST still get escalation (preserve 25+ behavior)
  it('FIX1: divergence_score=27 gets the existing higher-severity escalation (profile/sev 1+)', () => {
    const result = diagnose({
      divergence_score: 27,
      hw_avg: 72,
      quiz_avg: 68,
      error_types: [],
    });
    expect(result).not.toBeNull();
    // The existing pattern 3 (generic divergence >= 25) fires: profile, sev 1
    expect(result!.suggestedAction).toBe('profile');
    expect(result!.severity).toBe(1);
  });

  // FIX 1 (a2): gap-27 + low quiz must still get reteach sev 3
  it('FIX1: divergence_score=27 + low quiz still gets reteach sev 3 (25+ escalation preserved)', () => {
    const result = diagnose({
      divergence_score: 27,
      hw_avg: 80,
      quiz_avg: 40,
      error_types: [],
    });
    expect(result).not.toBeNull();
    expect(result!.suggestedAction).toBe('reteach');
    expect(result!.severity).toBe(3);
  });

  // FIX 1 (a2): divergence_score exactly 20 must surface (floor is inclusive)
  it('FIX1: divergence_score=20 surfaces (floor is inclusive)', () => {
    const result = diagnose({
      divergence_score: 20,
      hw_avg: 72,
      quiz_avg: 68,
      error_types: [],
    });
    expect(result).not.toBeNull();
    expect(result!.severity).toBe(1);
    expect(result!.suggestedAction).toBe('monitor');
  });

  // FIX 1 (a2): divergence_score exactly 25 triggers the higher 25+ path (not monitor)
  it('FIX1: divergence_score=25 triggers profile (25+ path) not monitor (20-24 path)', () => {
    const result = diagnose({
      divergence_score: 25,
      hw_avg: 72,
      quiz_avg: 68,
      error_types: [],
    });
    expect(result).not.toBeNull();
    // 25 hits existing pattern 3 (profile), not the new monitor tier
    expect(result!.suggestedAction).toBe('profile');
    expect(result!.suggestedAction).not.toBe('monitor');
  });

  // Old test (preserved): returns null when fine — divergence < threshold and no recurring errors
  // Note: 20 now surfaces, so updated to use score=19
  it('returns null when fine — divergence < 20 and no recurring errors', () => {
    const result = diagnose({
      divergence_score: 19,
      hw_avg: 72,
      quiz_avg: 68,
      error_types: ['reasoning_gap', 'reasoning_gap'], // only 2, below threshold
    });
    expect(result).toBeNull();
  });
});
