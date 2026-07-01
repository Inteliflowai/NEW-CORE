'use client';
// Teacher-only read-only view of one student's SPARK attempt.
// Renders pre-formatted segments from /api/teacher/challenges/attempt —
// raw answer values never reach this component. Belt-and-braces: an image
// segment is still re-checked for a data:image/ prefix before <img>.
import { useEffect, useState } from 'react';
import type { DisplaySegment } from '@/lib/spark/formatStepResponse';
import { RUBRIC_LABEL } from './ChallengeCard';

interface StepInfo { order: number; title: string; type: string; description: string }
interface PanelData {
  review: {
    attempt: { state: string; completedAt: string | null; score: number | null;
               effortLabel: string | null; revisionCount: number | null; teliHintCount: number | null };
    generationStatus: string | null;
    steps: StepInfo[] | null;
    analysis: { rubric_dimensions: Record<string, number | null> | null;
                dimension_observations: Record<string, string> | null;
                key_observations: string[]; content_quality: string | null } | null;
  };
  responseIndexes: number[];
  segmentsByStep: Record<string, DisplaySegment[]>;
}
type PanelState =
  | { phase: 'loading' } | { phase: 'not_started' } | { phase: 'unreachable' }
  | { phase: 'ready'; data: PanelData };

const DATA_IMAGE = /^data:image\//;
const EXTENSION_INDEX = 9999;

// Friendly rubric-dimension labels: reuses ChallengeCard's RUBRIC_LABEL (the
// single source of truth) — falls back to the raw key only for unknown
// dimensions, and never shows a snake_case key for a known one.
function rubricLabel(dim: string): string {
  return RUBRIC_LABEL[dim] ?? dim;
}

export default function StudentWorkPanel({ assignmentId }: { assignmentId: string }) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' });
  // Collapsed by default and only rendered when open: a native <details> keeps
  // its children in the DOM at all times (just CSS-hidden), which would make a
  // step title collide with the same title shown in "Student's answers" below.
  const [showChallenge, setShowChallenge] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/teacher/challenges/attempt?assignmentId=${encodeURIComponent(assignmentId)}`);
        if (cancelled) return;
        if (res.status === 404) {
          // Disambiguate: only SPARK's "no attempt" maps to the quiet state.
          // Other 404s (spark_not_enabled, assignment lookup) get the generic one —
          // a scored row with a disabled link must NOT claim the student never started.
          const body = await res.json().catch(() => ({} as { error?: string }));
          setState(body?.error === 'not_started' ? { phase: 'not_started' } : { phase: 'unreachable' });
          return;
        }
        if (!res.ok) { setState({ phase: 'unreachable' }); return; }
        setState({ phase: 'ready', data: (await res.json()) as PanelData });
      } catch {
        if (!cancelled) setState({ phase: 'unreachable' });
      }
    })();
    return () => { cancelled = true; };
  }, [assignmentId]);

  if (state.phase === 'loading') {
    return <p className="text-sm text-fg-muted py-2" role="status">Loading student’s work…</p>;
  }
  if (state.phase === 'not_started') {
    // Non-asserting observation: this path usually indicates a SPARK-side data
    // gap (the row only exists because a completion arrived), not student inaction.
    return <p className="text-sm text-fg py-2">We don’t see this student’s work in SPARK yet.</p>;
  }
  if (state.phase === 'unreachable') {
    return <p className="text-sm text-fg py-2">We couldn’t reach SPARK right now — the work is safe there; try again in a moment.</p>;
  }

  const { review, responseIndexes, segmentsByStep } = state.data;
  const steps = review.steps ?? [];
  const orderedIndexes = [...new Set(responseIndexes)].sort((a, b) => a - b);

  const stepLabel = (idx: number): StepInfo | null =>
    idx === EXTENSION_INDEX ? { order: 0, title: 'Extension problem', type: 'claim_evidence', description: '' }
      : steps[idx] ?? null;

  return (
    <div className="mt-2 border-t border-sidebar-edge pt-3 space-y-4" data-testid="student-work-panel">
      {steps.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowChallenge((v) => !v)}
            aria-expanded={showChallenge}
            className="text-sm font-semibold text-fg cursor-pointer"
          >
            The challenge this student saw
          </button>
          {showChallenge && (
            <div className="mt-2 space-y-2">
              {steps.map((s) => (
                <div key={s.order}>
                  <p className="text-xs font-semibold text-fg">{s.order}. {s.title}</p>
                  <p className="text-sm text-fg whitespace-pre-wrap">{s.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        <p className="text-sm font-semibold text-fg">Student’s answers</p>
        {orderedIndexes.filter((i) => (segmentsByStep[String(i)] ?? []).length > 0).length === 0 ? (
          <p className="text-sm text-fg">No written answers yet.</p>
        ) : (
          orderedIndexes.map((idx) => {
            const segs = segmentsByStep[String(idx)] ?? [];
            if (segs.length === 0) return null;
            const info = stepLabel(idx);
            return (
              <div key={idx} className="rounded border border-sidebar-edge p-2">
                <p className="text-xs font-semibold text-fg">
                  {info ? (idx === EXTENSION_INDEX ? info.title : `${info.order}. ${info.title}`) : `Step ${idx + 1}`}
                </p>
                {segs.map((seg, i) =>
                  seg.kind === 'image' && DATA_IMAGE.test(seg.dataUrl) ? (
                    <img key={i} src={seg.dataUrl} alt={`Student’s ${seg.label.toLowerCase()}`}
                         className="mt-1 max-h-64 rounded border border-sidebar-edge" />
                  ) : seg.kind === 'text' ? (
                    <p key={i} className="text-sm text-fg mt-1">
                      <span className="font-medium">{seg.label}: </span>
                      <span className="whitespace-pre-wrap">{seg.text}</span>
                    </p>
                  ) : null,
                )}
              </div>
            );
          })
        )}
      </div>

      {review.analysis && (
        <div className="space-y-1">
          {/* key_observations were authored FOR the student (they saw the first
              one as "Teli says" — second-person redirects possible), so the
              heading is voice-transparent. Barb gates the wording. */}
          <p className="text-sm font-semibold text-fg">What the AI shared with the student</p>
          {review.analysis.key_observations.map((o, i) => (
            <p key={i} className="text-sm text-fg">{o}</p>
          ))}
          {review.analysis.dimension_observations &&
            Object.entries(review.analysis.dimension_observations).map(([dim, obs]) => (
              <p key={dim} className="text-sm text-fg">
                <span className="font-medium">{rubricLabel(dim)}: </span>{obs}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
