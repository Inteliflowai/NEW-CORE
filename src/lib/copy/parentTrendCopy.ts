// src/lib/copy/parentTrendCopy.ts
// Parent-voiced, number-free trend copy. Four-audience: no digits, no band/CL
// verbs, no peer comparisons. Name-free by design so callers can assertNoLeak.
// Barb gates final wording (STRINGS-FOR-BARB.md §Parent Shell).

export type TrendDirection = 'climbing' | 'steady' | 'sliding' | null;

/** One calm, name-free lead sentence about how grades have moved over time. */
export function parentTrendLead(direction: TrendDirection): string {
  if (direction === 'climbing') return 'There is real momentum here lately.';
  if (direction === 'steady') return 'Things are holding a steady pace.';
  if (direction === 'sliding') return 'It has been a little uneven lately — a good moment to check in.';
  return 'We are still building a learning history — keep checking back.';
}
