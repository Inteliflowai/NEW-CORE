// Server-only client for SPARK's get_attempt_review integration action.
// Fail-soft by contract: every failure mode maps to a typed result — the
// challenges page must never crash or hang on SPARK (10s cap, spark-client
// house pattern). Defensive mapping: unknown/malformed fields degrade to
// null/[] instead of throwing.
import { SPARK_API_URL } from '@/lib/spark/config';

export interface SparkStep { order: number; title: string; type: string; description: string }
export interface SparkStepResponse { step_index: number; type: string; value: unknown; completed: boolean }
export interface SparkAnalysis {
  rubric_dimensions: Record<string, number | null> | null;
  dimension_observations: Record<string, string> | null;
  key_observations: string[];
  content_quality: string | null;
}
export interface SparkAttemptReview {
  attempt: {
    state: string; startedAt: string | null; completedAt: string | null;
    score: number | null; effortLabel: string | null;
    revisionCount: number | null; teliHintCount: number | null;
  };
  generationStatus: string | null;
  steps: SparkStep[] | null;
  stepResponses: SparkStepResponse[];
  analysis: SparkAnalysis | null;
}
export type FetchReviewResult =
  | { ok: true; review: SparkAttemptReview }
  | { ok: false; reason: 'not_found' | 'unreachable' };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// All-or-nothing: a single malformed element invalidates the WHOLE array. Dropping just the
// bad element (via `continue`) would shift every subsequent element's array position, and the
// panel labels answers by `steps[idx]` positionally — a shifted array silently mislabels an
// answer with a neighbor's title. Degrading to null (→ safe "Step N" fallback labels) is safer
// than a wrong-but-plausible-looking title.
function mapSteps(v: unknown): SparkStep[] | null {
  if (!Array.isArray(v)) return null;
  const out: SparkStep[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    if (typeof o.order !== 'number' || typeof o.title !== 'string' || typeof o.type !== 'string') return null;
    out.push({ order: o.order, title: o.title, type: o.type, description: str(o.description) ?? '' });
  }
  return out.length ? out : null;
}

function mapResponses(v: unknown): SparkStepResponse[] {
  if (!Array.isArray(v)) return [];
  const out: SparkStepResponse[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.step_index !== 'number' || typeof o.type !== 'string') continue;
    out.push({ step_index: o.step_index, type: o.type, value: o.value, completed: o.completed === true });
  }
  return out;
}

function mapAnalysis(v: unknown): SparkAnalysis | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  // spark_ai_analysis.result is LLM-derived JSON — validate VALUES, not just
  // containers, or a non-string observation becomes a React-child crash in the panel.
  const rubric = o.rubric_dimensions && typeof o.rubric_dimensions === 'object'
    ? (Object.fromEntries(Object.entries(o.rubric_dimensions as Record<string, unknown>)
        .filter(([, val]) => typeof val === 'number' || val === null)) as Record<string, number | null>)
    : null;
  const dims = o.dimension_observations && typeof o.dimension_observations === 'object'
    ? (Object.fromEntries(Object.entries(o.dimension_observations as Record<string, unknown>)
        .filter(([, val]) => typeof val === 'string')) as Record<string, string>)
    : null;
  return {
    rubric_dimensions: rubric && Object.keys(rubric).length ? rubric : null,
    dimension_observations: dims && Object.keys(dims).length ? dims : null,
    key_observations: Array.isArray(o.key_observations)
      ? o.key_observations.filter((k): k is string => typeof k === 'string') : [],
    content_quality: str(o.content_quality),
  };
}

export async function fetchAttemptReview(args: {
  apiKey: string; coreHomeworkId: string; coreStudentId: string;
}): Promise<FetchReviewResult> {
  try {
    const res = await fetch(`${SPARK_API_URL}/api/integration/core`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.apiKey}` },
      body: JSON.stringify({
        action: 'get_attempt_review',
        core_homework_id: args.coreHomeworkId,
        core_student_id: args.coreStudentId,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (res.status === 404) return { ok: false, reason: 'not_found' };
    if (!res.ok) {
      // Observability only — status code, never the api key or request headers.
      console.warn('[spark-review] fetch failed', { status: res.status });
      return { ok: false, reason: 'unreachable' };
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const a = (raw.attempt ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      review: {
        attempt: {
          state: str(a.state) ?? 'unknown',
          startedAt: str(a.started_at), completedAt: str(a.completed_at),
          score: num(a.score), effortLabel: str(a.effort_label),
          revisionCount: num(a.revision_count), teliHintCount: num(a.teli_hint_count),
        },
        generationStatus: str(raw.generation_status),
        steps: mapSteps(raw.steps),
        stepResponses: mapResponses(raw.step_responses),
        analysis: mapAnalysis(raw.analysis),
      },
    };
  } catch (err) {
    // Observability only — the exception's message (network/timeout reason), never
    // the api key or request headers.
    console.warn('[spark-review] fetch failed', { reason: (err as Error)?.message ?? 'unknown' });
    return { ok: false, reason: 'unreachable' };
  }
}
