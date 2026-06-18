// src/lib/utils/masteryLabel.ts
// Single-sourced helper: maps raw DB mastery_band enum → student-safe soft label.
// SCOPE §15: never expose raw enum ('reteach'/'grade_level'/'advanced') to students.
// Pure + import-safe (no Next.js / Supabase imports).

const BAND_LABELS: Record<string, string> = {
  reteach: 'Building',
  grade_level: 'On Track',
  advanced: 'Strong',
};

/**
 * Maps a raw DB mastery_band enum value to a student-facing soft label.
 * null / unknown values → 'Not yet assessed'.
 */
export function masteryDisplayLabel(band: string | null | undefined): string {
  if (!band) return 'Not yet assessed';
  return BAND_LABELS[band] ?? 'Not yet assessed';
}
