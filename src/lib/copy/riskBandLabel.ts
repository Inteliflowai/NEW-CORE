// src/lib/copy/riskBandLabel.ts
// Bands a raw 0–100 (or 0–1) risk score into a display label.
// SCOPE §16 / spec §4: teacher/admin surfaces render the BAND, never the raw number.
// Pure + import-safe (no Next.js / Supabase imports).

export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

/**
 * Converts a numeric risk score to a display band.
 *
 * @param score  - Raw score on the chosen scale.
 * @param scale  - '0to100' (default) or '0to1' (multiplied ×100 before banding).
 * @returns      - 'low' (<25) / 'medium' (<50) / 'high' (<75) / 'critical' (≥75).
 */
export function riskBandLabel(
  score: number,
  scale: '0to1' | '0to100' = '0to100',
): RiskBand {
  const normalised = scale === '0to1' ? score * 100 : score;
  if (normalised < 25) return 'low';
  if (normalised < 50) return 'medium';
  if (normalised < 75) return 'high';
  return 'critical';
}
