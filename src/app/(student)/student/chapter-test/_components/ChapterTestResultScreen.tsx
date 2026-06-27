'use client';

/**
 * ChapterTestResultScreen — polls the grading endpoint until the attempt is
 * graded, then shows the student their earned grade and a per-section
 * collapsible breakdown.
 *
 * Four-audience:
 *  - total_grade / section_grade are SUMMATIVE earned grades — students may see
 *    them (same policy as homework; different from diagnostic quizzes).
 *  - ai_feedback is generated text that might contain diagnostic vocabulary or
 *    numeric leaks. We run hasLeak + hasDiagnosticVocab on every feedback string
 *    before render and substitute a safe fallback if either fires. Never crash,
 *    never show leaked content.
 *
 * Polling: setInterval every 3 s while status === 'submitted'. Interval is
 * cleared as soon as status === 'graded', and also on unmount via the
 * useEffect cleanup. The `mounted` ref prevents state updates on unmounted
 * components.
 */

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { hasLeak, hasDiagnosticVocab } from '@/lib/copy/leakGuard';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Safe substitute shown instead of any leaked ai_feedback. */
const SAFE_FEEDBACK_FALLBACK =
  'Keep working on this — your teacher will share more feedback soon.';

/** Polling interval while grading is in progress (ms). */
const POLL_INTERVAL_MS = 3_000;

// ── Types (mirror GET /api/attempts/chapter-test/[attemptId] response) ─────────

type QuestionResult = {
  question_order: number;
  question_type: string;
  question_text: string;
  points: number;
  grade: number | null;
  ai_feedback: string | null;
  response_text: string | null;
};

type SectionResult = {
  section_order: number;
  title: string;
  section_grade: number | null;
  section_max: number;
  questions: QuestionResult[];
};

type AttemptResult = {
  status: string;
  total_grade: number | null;
  total_max: number | null;
  forfeit_reason: string | null;
  sections: SectionResult[];
};

// ── Four-audience guard ────────────────────────────────────────────────────────

/**
 * Returns the safe fallback string if ai_feedback contains a numeric leak
 * (hasLeak) or a diagnostic teacher-only vocabulary term (hasDiagnosticVocab).
 * Returns the original string only when it is clean.
 * Never throws.
 */
function guardFeedback(feedback: string | null): string | null {
  if (feedback == null) return null;
  if (hasLeak(feedback) || hasDiagnosticVocab(feedback)) {
    console.warn(
      '[ChapterTestResultScreen] ai_feedback audience leak detected — substituting safe fallback.',
    );
    return SAFE_FEEDBACK_FALLBACK;
  }
  return feedback;
}

// ── Section accordion ──────────────────────────────────────────────────────────

function SectionAccordion({ section }: { section: SectionResult }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-surface bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="font-semibold text-fg text-sm">{section.title}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-fg-muted text-sm">
            {section.section_grade ?? '—'} / {section.section_max}
          </span>
          <span aria-hidden className="text-fg-muted text-sm">
            {open ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {open && (
        <ul className="px-4 pb-4 border-t border-surface pt-3 flex flex-col gap-4">
          {section.questions.map((q) => {
            const safeFeedback = guardFeedback(q.ai_feedback);
            return (
              <li key={q.question_order} className="flex flex-col gap-1">
                <p className="text-fg text-sm leading-snug">{q.question_text}</p>
                {q.response_text != null && q.response_text !== '' && (
                  <p className="text-fg-muted text-xs">
                    Your answer: {q.response_text}
                  </p>
                )}
                {safeFeedback != null && (
                  <p className="text-fg-muted text-xs italic">{safeFeedback}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────────

function GradingSpinner() {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-4 py-12 px-6 text-center"
    >
      {/* Decorative spinner — aria-hidden; role="status" on the container */}
      <span
        aria-hidden
        className="inline-block w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin"
      />
      <p className="text-fg text-base">Grading your test…</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface ChapterTestResultScreenProps {
  attemptId: string;
}

export function ChapterTestResultScreen({
  attemptId,
}: ChapterTestResultScreenProps) {
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Keep a mutable ref to the interval so we can clear it from inside the
  // async poll callback without capturing a stale closure.
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );

  useEffect(() => {
    let mounted = true;

    async function poll(): Promise<void> {
      try {
        const res = await fetch(`/api/attempts/chapter-test/${attemptId}`);
        if (!mounted) return;

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!mounted) return;
          setFetchError(
            body.error ?? 'Something went wrong loading your results.',
          );
          clearInterval(intervalRef.current);
          return;
        }

        const data = (await res.json()) as AttemptResult;
        if (!mounted) return;

        setResult(data);

        // Stop polling once grading is complete.
        if (data.status === 'graded') {
          clearInterval(intervalRef.current);
        }
      } catch {
        if (!mounted) return;
        setFetchError('Unable to load your results. Please try refreshing.');
        clearInterval(intervalRef.current);
      }
    }

    void poll();
    intervalRef.current = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(intervalRef.current);
    };
  }, [attemptId]);

  // ── Error ──────────────────────────────────────────────────────────────────
  if (fetchError != null) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 px-6 text-center">
        <p className="text-warn-fg text-base">{fetchError}</p>
        <Link
          href="/student/assignments"
          className="text-brand underline text-sm"
        >
          Back to assignments
        </Link>
      </div>
    );
  }

  // ── Grading in progress (initial fetch not yet complete, or still 'submitted')
  if (result == null || result.status === 'submitted') {
    return <GradingSpinner />;
  }

  // ── Graded ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 py-8 px-4 max-w-xl mx-auto">
      {/* Score — total_grade is a summative earned grade; students may see it. */}
      <div className="text-center flex flex-col gap-2">
        <h1 className="font-display text-2xl text-fg font-bold">
          You scored {result.total_grade ?? '—'} out of{' '}
          {result.total_max ?? '—'}
        </h1>
        {result.forfeit_reason === 'time_up' && (
          <p className="text-warn-fg text-sm">Time was up</p>
        )}
      </div>

      {/* Per-section collapsible breakdown */}
      {result.sections.length > 0 && (
        <div className="flex flex-col gap-3">
          {result.sections.map((section) => (
            <SectionAccordion
              key={section.section_order}
              section={section}
            />
          ))}
        </div>
      )}

      {/* Navigation */}
      <Link
        href="/student/assignments"
        className="rounded-lg border-2 border-surface bg-surface text-fg font-semibold px-6 py-3 hover:border-brand text-center block"
      >
        Back to assignments
      </Link>
    </div>
  );
}
