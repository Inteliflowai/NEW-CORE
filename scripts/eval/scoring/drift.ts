// ============================================================
// scripts/eval/scoring/drift.ts
//
// Pure drift-scoring helpers. Different scope items use different
// drift metrics — these primitives compose into the runner-specific
// drift functions. No SDK calls. No I/O. Fully testable in isolation.
//
// Threshold policy (from design doc §"Threshold policy"):
//   - drift < 0.05         → pass
//   - 0.05 ≤ drift < 0.15  → warning
//   - drift ≥ 0.15         → regression
// ============================================================

import type { TupleDrift } from '../types';

export const DRIFT_PASS_THRESHOLD = 0.05;
export const DRIFT_REGRESSION_THRESHOLD = 0.15;

/**
 * Numeric drift on a known scale. Returns 0..1 normalized by the
 * scale.
 *
 *   numericDrift(0.8, 0.85, { scale: 1.0 }) === 0.05
 *   numericDrift(2, 4,    { scale: 4 })     === 0.5
 */
export function numericDrift(
  candidate: number,
  expected: number,
  { scale }: { scale: number },
): number {
  if (scale <= 0) return 0;
  const raw = Math.abs(candidate - expected) / scale;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Binary drift: 0 if values match, 1 if they don't. Used for enums
 * (e.g. content_quality, modality) where any mismatch is total
 * drift.
 */
export function binaryDrift<T>(candidate: T, expected: T): number {
  return candidate === expected ? 0 : 1;
}

/**
 * Structural drift: fraction of expected fields that are missing
 * from the candidate. Inputs are object maps where each value is
 * a boolean (present/absent in the output).
 *
 *   structuralDrift({a: true, b: true}, {a: true, b: true}) === 0
 *   structuralDrift({a: true, b: false}, {a: true, b: true}) === 0.5
 */
export function structuralDrift(
  candidate: Record<string, boolean>,
  expected: Record<string, boolean>,
): number {
  const expectedKeys = Object.keys(expected).filter((k) => expected[k]);
  if (expectedKeys.length === 0) return 0;
  let missing = 0;
  for (const k of expectedKeys) {
    if (!candidate[k]) missing += 1;
  }
  return missing / expectedKeys.length;
}

/**
 * Set coverage drift: fraction of expected items NOT covered by the
 * candidate. Order-insensitive, case-insensitive comparison on
 * trimmed strings.
 *
 *   coverageDrift(['photosynthesis', 'chloroplast'], ['photosynthesis']) === 0
 *   coverageDrift(['x'], ['photosynthesis', 'chloroplast']) === 1
 */
export function coverageDrift(
  candidate: readonly string[],
  expected: readonly string[],
): number {
  if (expected.length === 0) return 0;
  const cand = new Set(candidate.map((s) => s.toLowerCase().trim()));
  let missing = 0;
  for (const e of expected) {
    if (!cand.has(e.toLowerCase().trim())) missing += 1;
  }
  return missing / expected.length;
}

/**
 * Combine per-component drifts into one aggregate using a weighted
 * mean. Weights are floats; missing weights default to 1.
 *
 *   aggregateDrift({score: 0.1, notes: 0.2}, {score: 2, notes: 1}) === 0.133
 */
export function aggregateDrift(
  components: Record<string, number>,
  weights: Record<string, number> = {},
): number {
  const keys = Object.keys(components);
  if (keys.length === 0) return 0;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const k of keys) {
    const w = weights[k] ?? 1;
    weightedSum += components[k] * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}

/**
 * Tier classification per the threshold policy. Pure — no side
 * effects.
 */
export function tierFor(drift: number): TupleDrift['tier'] {
  if (drift < DRIFT_PASS_THRESHOLD) return 'pass';
  if (drift < DRIFT_REGRESSION_THRESHOLD) return 'warning';
  return 'regression';
}

/**
 * Aggregate gate per the design doc:
 *   - regression on any tuple → regression
 *   - >25% of tuples in 5-15% range → regression
 *   - >10% of tuples in 5-15% range → warning
 *   - otherwise → pass
 */
export function aggregateGate(tiers: ReadonlyArray<TupleDrift['tier']>): {
  gate: TupleDrift['tier'];
  reason: string;
} {
  if (tiers.length === 0) {
    return {
      gate: 'pass',
      reason: 'Corpus is empty — gate trivially passes. Populate the corpus before relying on this eval as a regression check.',
    };
  }
  const counts = { pass: 0, warning: 0, regression: 0 };
  for (const t of tiers) counts[t] += 1;
  if (counts.regression > 0) {
    return {
      gate: 'regression',
      reason: `${counts.regression} tuple(s) regressed (drift ≥ ${DRIFT_REGRESSION_THRESHOLD}).`,
    };
  }
  const warnPct = counts.warning / tiers.length;
  if (warnPct > 0.25) {
    return {
      gate: 'regression',
      reason: `${counts.warning}/${tiers.length} tuples in warning tier — exceeds 25% threshold.`,
    };
  }
  if (warnPct > 0.10) {
    return {
      gate: 'warning',
      reason: `${counts.warning}/${tiers.length} tuples in warning tier — between 10% and 25%. Barb review required before merge.`,
    };
  }
  return {
    gate: 'pass',
    reason: `All ${counts.pass} pass / ${counts.warning} warning / ${counts.regression} regression. Within thresholds.`,
  };
}
