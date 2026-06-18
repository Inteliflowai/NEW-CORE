// src/lib/utils/learningStyle.ts
// Write-boundary DB normalizer for learning_style (C6).
// LIFTED from V1 lib/utils/learningStyle.ts — ONLY the normalizer.
// DO NOT import display helpers (canonicalLearningStyle / learningStyleLabel /
// learningStyleArticle) — they depend on @/lib/i18n/locale (scope-out §19, Plan-4 UI).
// This file must stay import-safe (no i18n, no next/server).
//
// Mapping rules (C6):
//   read_write | read/write | read-write | readwrite → 'text'
//   tactile → 'kinesthetic'
//   accepted pass-through: visual | auditory | text | kinesthetic | social | emerging
//   null | '' | unknown → 'emerging'

/** Accepted canonical values in assignments.learning_style (DB text column, V2). */
const ENUM_ACCEPTED = new Set([
  'visual',
  'auditory',
  'text',
  'kinesthetic',
  'social',
  'emerging',
]);

/** Alias → canonical mapping (applied after lower-casing). */
const ALIASES: Record<string, string> = {
  read_write: 'text',
  'read/write': 'text',
  'read-write': 'text',
  readwrite: 'text',
  tactile: 'kinesthetic',
};

/**
 * Normalize a raw learning_style value at the DB write boundary.
 * - Applies the ALIASES map (read_write → text, tactile → kinesthetic).
 * - Passes through ENUM_ACCEPTED values unchanged.
 * - Returns 'emerging' for null / undefined / '' / unknown garbage.
 *
 * NOTE: The 6-value prompt vocabulary (visual|auditory|read_write|kinesthetic|
 * tactile|emerging) flows through the engine as-is; this normalizer is applied
 * ONLY when inserting into assignments.learning_style.
 */
export function normalizeLearningStyle(raw: string | null | undefined): string {
  if (raw == null || raw === '') return 'emerging';
  const lower = raw.toLowerCase();
  if (lower in ALIASES) return ALIASES[lower];
  if (ENUM_ACCEPTED.has(lower)) return lower;
  return 'emerging';
}
