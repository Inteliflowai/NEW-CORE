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
/**
 * Default recencyDays when the field is absent — treated as old (999 days,
 * the clamp ceiling) so missing-recency items sort to the bottom within their
 * severity band.
 */
const DEFAULT_RECENCY_DAYS = 999;
/** Maximum recencyDays considered; values above this are clamped to prevent
 *  the recency term from bleeding into the severity band. */
const MAX_RECENCY_DAYS = 999;

/**
 * Returns a numeric rank score for a diagnostic signal.
 *
 * Higher score = more prominent in the narrative feed.
 *
 * Formula (strict severity-first bands):
 *   severity * 1_000_000
 *   − Math.min(recencyDays, 999) * 1000   (smaller recencyDays → higher rank)
 *   + actionPriority                       (0–5; breaks exact recency ties only)
 *
 * Band guarantees:
 *   - Any severity N always outranks any severity N-1, regardless of recency or action.
 *   - Within a severity, a more-recent item (smaller recencyDays) always outranks an
 *     older one, regardless of action.
 *   - actionPriority (max 5) breaks ties only when severity AND clamped recency are equal.
 *
 * Missing recencyDays defaults to 999 (treated as old within the band).
 */
export function narrativeRank(s: {
  severity: number;
  recencyDays?: number;
  action?: string;
}): number {
  const recency = Math.min(s.recencyDays ?? DEFAULT_RECENCY_DAYS, MAX_RECENCY_DAYS);
  const actionPriority =
    s.action !== undefined
      ? (ACTION_PRIORITY[s.action] ?? DEFAULT_ACTION_PRIORITY)
      : DEFAULT_ACTION_PRIORITY;

  return s.severity * 1_000_000 - recency * 1000 + actionPriority;
}
