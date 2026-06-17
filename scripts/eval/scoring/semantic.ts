// ============================================================
// scripts/eval/scoring/semantic.ts
//
// Semantic similarity primitives. Stage A uses a zero-dependency
// bag-of-words token similarity (Jaccard + cosine on TF). Stage B
// will swap this for a real embedding model (OpenAI text-embedding-3
// or similar) — the function signature stays stable so the swap is
// drop-in.
//
// Why not embeddings now: corpus is empty in Stage A, the rig has
// no real evaluation work to do, and embedding API calls add cost
// and latency to a pipeline that isn't producing signal yet. The
// token-similarity placeholder is good enough to (a) typecheck, (b)
// drift-lock the call sites, (c) detect obvious regressions
// (rewrites that change >50% of vocabulary).
//
// When upgrading to embeddings: keep `semanticDrift(a, b)` as the
// public API. Only the implementation changes.
// ============================================================

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'of',
  'on', 'or', 'she', 'that', 'the', 'their', 'them', 'they', 'this',
  'to', 'was', 'were', 'with', 'you', 'your',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [t, va] of a) {
    normA += va * va;
    const vb = b.get(t) ?? 0;
    dot += va * vb;
  }
  for (const [, vb] of b) normB += vb * vb;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Semantic similarity on [0..1]. 1 = identical content; 0 = no
 * shared vocabulary.
 *
 * Stage A: token-cosine. Stage B: replace with embedding cosine.
 * Public API is stable across the swap.
 */
export function semanticSimilarity(a: string, b: string): number {
  // Short-circuit on exact match — avoids floating-point error
  // making "identical" inputs report 0.9999999... similarity.
  if (a === b) return 1;
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  return cosineSimilarity(termFrequencies(ta), termFrequencies(tb));
}

/**
 * Drift = 1 - similarity. A drift of 0 means identical, 1 means
 * unrelated.
 */
export function semanticDrift(a: string, b: string): number {
  return 1 - semanticSimilarity(a, b);
}
