// src/lib/copy/narrativeRank.ts
// Deterministic rank score for ordering diagnostic signals in a narrative feed.
// Severity-first, then recency (lower recencyDays = more recent = higher rank),
// then a stable per-action tiebreak so no two items ever share the same rank.
// Pure + import-safe (no Next.js / Supabase imports).

/** The five suggestedAction values, ordered by priority for tiebreaks. */
const ACTION_PRIORITY: Record<string, number> = {
  reteach: 5,
  practice: 4,
  verbal_check: 3,
  profile: 2,
  monitor: 1,
};

const DEFAULT_ACTION_PRIORITY = 0;
const DEFAULT_RECENCY_DAYS = 365; // treat missing recency as old

/**
 * Returns a numeric rank score for a diagnostic signal.
 *
 * Higher score = more prominent in the narrative feed.
 *
 * Formula:
 *   severity * 1000
 *   − recencyDays * 10          (smaller recencyDays → higher rank)
 *   + actionPriority            (stable per-action offset, never 0 ambiguity)
 */
export function narrativeRank(s: {
  severity: number;
  recencyDays?: number;
  action?: string;
}): number {
  const recency = s.recencyDays ?? DEFAULT_RECENCY_DAYS;
  const actionPriority =
    s.action !== undefined
      ? (ACTION_PRIORITY[s.action] ?? DEFAULT_ACTION_PRIORITY)
      : DEFAULT_ACTION_PRIORITY;

  return s.severity * 1000 - recency * 10 + actionPriority;
}
