// src/lib/lessons/duplicateDetect.ts
// Keyword Jaccard similarity for "is this lesson a duplicate?" — title (0.6) + concept tags (0.4).
// Pure + import-safe (no Next/Supabase). Ported from V1 lib/lessons/duplicateDetect.ts.
export interface LessonRowLite { id: string; title: string | null; concept_tags: string[]; date?: string }
export interface DuplicateMatch { lesson: LessonRowLite; similarity: number; titleScore: number; tagScore: number }

const STOPWORDS = new Set(['the','a','an','and','or','of','to','in','on','for','with','intro','introduction','lesson','unit','part','day','grade']);

export function tokenize(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s.toLowerCase().split(/[^a-z0-9À-ſ]+/).filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}
function computeSimilarity(candidate: { title: string | null; concept_tags: string[] }, existing: LessonRowLite) {
  const titleScore = jaccard(tokenize(candidate.title), tokenize(existing.title));
  const candTags = new Set<string>(); for (const t of candidate.concept_tags ?? []) for (const tok of tokenize(t)) candTags.add(tok);
  const exTags = new Set<string>(); for (const t of existing.concept_tags ?? []) for (const tok of tokenize(t)) exTags.add(tok);
  const tagScore = jaccard(candTags, exTags);
  return { titleScore, tagScore, similarity: 0.6 * titleScore + 0.4 * tagScore };
}
export function detectDuplicates(
  candidate: { id?: string; title: string | null; concept_tags: string[] },
  existing: ReadonlyArray<LessonRowLite>,
  threshold = 0.6,
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const ex of existing) {
    if (candidate.id && ex.id === candidate.id) continue;
    const { titleScore, tagScore, similarity } = computeSimilarity(candidate, ex);
    if (similarity >= threshold) matches.push({ lesson: ex, similarity, titleScore, tagScore });
  }
  return matches.sort((a, b) => b.similarity - a.similarity);
}
