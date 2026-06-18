// src/lib/skills/skillSlug.ts
// Phase 2a — pure skill-tag normalization. No DB / AI imports
// (Bug #27 sibling-pure-file pattern); fully unit-testable.
//
// The AI emits free-text concept tags ('Decimal operations',
// 'decimal_ops', 'Multiplicacao de fracoes'). The slug is the
// registry identity: same slug at the same (school, subject) =
// same skill. Folding rules below are deliberately aggressive —
// a false merge is teacher-fixable (rename/split later), while a
// phantom split silently fragments a student's per-skill history.

const COMBINING_ACCENTS = /[̀-ͯ]/g;

/**
 * Normalize a raw AI-emitted skill tag into its registry slug.
 * - case-insensitive
 * - accent-folded (PT-BR: 'Multiplicação' → 'multiplicacao')
 * - punctuation/whitespace runs collapse to single underscores
 * - capped at 80 chars (index-friendly, tags are short anyway)
 */
export function slugifySkillTag(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(COMBINING_ACCENTS, '')
    .toLowerCase()
    .replace(/['’"]/g, '')      // apostrophes vanish, don't split
    .replace(/[^a-z0-9]+/g, '_')     // everything else → underscore runs
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

/**
 * Clean a raw tag into a display name: trim + collapse internal
 * whitespace. Keeps the teacher-readable casing the AI emitted —
 * the first-seen raw tag names the skill; later variants become
 * aliases.
 */
export function skillDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 120);
}

/** Normalize a class subject for registry scoping (null-safe). */
export function normalizeSubject(subject: string | null | undefined): string | null {
  const s = (subject ?? '').trim();
  return s.length ? s : null;
}