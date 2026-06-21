/**
 * CORE V2 — Behavioral Signals EMA Model Helper
 *
 * This module provides two exports:
 *
 * 1. `emaMerge` — PURE function. Blends a previous ComputedSignals snapshot
 *    with a new one using an Exponential Moving Average (EMA). Numeric fields
 *    are smoothed; categorical and array fields always take the latest value.
 *    No Date.now(), no DB access, no side effects.
 *
 * 2. `upsertBehavioralSignals` — reads the existing `behavioral_signals` row
 *    for a student, applies `emaMerge`, and upserts the merged result. Uses
 *    the injected admin client so callers (and tests) control the DB connection.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ComputedSignals } from './behavioralTypes';

// ---------------------------------------------------------------------------
// Field classification
// ---------------------------------------------------------------------------

/** Numeric fields — blended as alpha*next + (1-alpha)*prev */
const NUMERIC_FIELDS: ReadonlyArray<keyof ComputedSignals> = [
  'learningVelocity',
  'frustrationScore',
  'attentionScore',
  'attentionGaps',
  'errorFrequency',
  'confidenceScore',
  'confidenceAccuracy',
  'engagementScore',
  'predictiveRiskScore',
  'sessionDurationMs',
];

/** Categorical fields — always replaced with `next` value */
const CATEGORICAL_FIELDS: ReadonlyArray<keyof ComputedSignals> = [
  'velocityTrend',
  'errorPatternType',
  'engagementStyle',
];

/** Array fields — always replaced with `next` value */
const ARRAY_FIELDS: ReadonlyArray<keyof ComputedSignals> = [
  'frustrationIndicators',
  'riskFactors',
];

// ---------------------------------------------------------------------------
// emaMerge — PURE
// ---------------------------------------------------------------------------

/**
 * Merge a previous ComputedSignals snapshot with a new one using EMA.
 *
 * - If `prev` is null (first observation) → returns `next` unchanged.
 * - Numeric fields: `alpha * next[f] + (1 - alpha) * prev[f]`
 * - Categorical fields (`velocityTrend`, `errorPatternType`, `engagementStyle`):
 *   always take `next[f]` (no interpolation makes sense for enums).
 * - Array fields (`frustrationIndicators`, `riskFactors`):
 *   always take `next[f]` (replace, not accumulate).
 *
 * @param prev   Previous stored snapshot, or null on first write.
 * @param next   Freshly computed snapshot from the current session.
 * @param alpha  Smoothing factor in [0, 1]; higher = more weight on latest. Default 0.4.
 * @returns      Merged ComputedSignals (no mutation of inputs).
 */
export function emaMerge(
  prev: ComputedSignals | null,
  next: ComputedSignals,
  alpha: number = 0.4,
): ComputedSignals {
  if (prev === null) {
    return next;
  }

  const merged = { ...next } as unknown as Record<string, unknown>;

  for (const field of NUMERIC_FIELDS) {
    const prevVal = prev[field] as number;
    const nextVal = next[field] as number;
    merged[field] = alpha * nextVal + (1 - alpha) * prevVal;
  }

  // Categorical + array fields already copied from `next` via spread above.
  // The explicit assignments below make the intent explicit and guard against
  // future field additions being accidentally treated as numeric.
  for (const field of CATEGORICAL_FIELDS) {
    merged[field] = next[field];
  }

  for (const field of ARRAY_FIELDS) {
    merged[field] = next[field];
  }

  return merged as unknown as ComputedSignals;
}

// ---------------------------------------------------------------------------
// upsertBehavioralSignals
// ---------------------------------------------------------------------------

interface UpsertParams {
  studentId: string;
  schoolId: string | null;
  next: ComputedSignals;
}

/**
 * Read the existing `behavioral_signals` row for the student, apply
 * `emaMerge(prev, next)`, and upsert the result.
 *
 * Uses the injected `admin` client (bypasses RLS) — callers must ensure
 * they pass `createAdminSupabaseClient()`.
 */
export async function upsertBehavioralSignals(
  admin: SupabaseClient,
  { studentId, schoolId, next }: UpsertParams,
): Promise<void> {
  // 1. Read existing row (if any)
  const { data: prev } = await admin
    .from('behavioral_signals')
    .select('computed, observation_count')
    .eq('student_id', studentId)
    .maybeSingle();

  // 2. Merge
  const prevComputed = (prev?.computed ?? null) as ComputedSignals | null;
  const merged = emaMerge(prevComputed, next);

  // 3. Upsert — updated_at is set here (NOT inside the pure emaMerge)
  await admin
    .from('behavioral_signals')
    .upsert(
      {
        student_id: studentId,
        school_id: schoolId,
        computed: merged,
        observation_count: (prev?.observation_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'student_id' },
    );
}
