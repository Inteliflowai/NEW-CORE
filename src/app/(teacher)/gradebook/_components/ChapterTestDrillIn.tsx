'use client';

/**
 * ChapterTestDrillIn — per-student chapter test breakdown panel.
 *
 * Opened by GradebookGrid when a chapter-test cell is clicked. Lazily fetches
 * GET /api/teacher/gradebook/chapter-attempt on mount (keeps the main gradebook
 * load light). Shows: test title, student name, status badge, total_grade / total_max,
 * and per-section collapsible rows with question text + student response + grade + AI feedback.
 *
 * TEACHER-ONLY surface — raw numeric grades are allowed at their render sites; all
 * surrounding prose must stay banned-word-free (four-audience). Section-level grade =
 * sum of individual question grades in that section (not stored; computed in the client).
 *
 * Token-only Tailwind v4; no hardcoded hex. All strings are DRAFTS → Barb.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { ChapterTestCell } from '@/lib/gradebook/loadGradebook';

// ── Props ─────────────────────────────────────────────────────────────────────────────────────
export interface ChapterTestDrillInProps {
  chapterTestId: string;
  chapterTitle: string;
  testTitle: string;
  studentId: string;
  studentName: string;
  /** Passed for future use (e.g. navigation, trend); not currently used in the panel body. */
  classId: string;
  cell: ChapterTestCell;
  onClose: () => void;
}

// ── API response types ────────────────────────────────────────────────────────────────────────
interface DrillInQuestion {
  question_order: number;
  question_type: string;
  question_text: string;
  points: number;
  response_text: string | null;
  response_payload: Record<string, unknown> | null;
  grade: number | null;
  ai_feedback: string | null;
}

interface DrillInSection {
  section_order: number;
  section_kind: string;
  title: string;
  time_minutes: number;
  total_points: number;
  questions: DrillInQuestion[];
}

interface DrillInData {
  attempt_id: string | null;
  status: 'not_started' | 'in_progress' | 'submitted' | 'graded';
  total_grade: number | null;
  total_max: number | null;
  sections: DrillInSection[];
}

// ── Constants ─────────────────────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
  graded: 'Graded',
};

const FOCUSABLE =
  'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

// ── Component ─────────────────────────────────────────────────────────────────────────────────
export function ChapterTestDrillIn({
  chapterTestId,
  chapterTitle,
  testTitle,
  studentId,
  studentName,
  onClose,
}: ChapterTestDrillInProps) {
  const [data, setData] = useState<DrillInData | null>(null);
  const [loading, setLoading] = useState(true);
  /** Set of expanded section_order numbers (collapsed by default). */
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Focus management — capture the triggering element; restore on close.
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    closeRef.current?.focus();
    return () => {
      triggerRef.current?.focus?.();
    };
  }, []);

  // Fetch on mount (lazy load — not included in the main gradebook query).
  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(
      `/api/teacher/gradebook/chapter-attempt?chapterTestId=${encodeURIComponent(chapterTestId)}&studentId=${encodeURIComponent(studentId)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DrillInData | null) => {
        if (live) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [chapterTestId, studentId]);

  // Keyboard handler: Escape → close; Tab → trap focus inside the panel.
  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      const root = panelRef.current;
      if (!root) return;
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((n) => !n.hasAttribute('disabled'));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function toggleSection(order: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(order)) {
        next.delete(order);
      } else {
        next.add(order);
      }
      return next;
    });
  }

  return (
    <>
      {/* Click-outside-to-close scrim — inert to screen readers. */}
      <div
        aria-hidden="true"
        data-testid="chapter-drill-in-backdrop"
        onClick={onClose}
        className="fixed inset-0 z-20 bg-fg/30"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${studentName} — ${testTitle}`}
        onKeyDown={onKeyDown}
        className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l-2 border-sidebar-edge bg-surface p-5 shadow-sticker-lg"
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-extrabold text-fg">
              {studentName}
            </h2>
            <p className="text-sm text-fg">
              {chapterTitle} — {testTitle}
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border-2 border-sidebar-edge px-2 py-1 text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            ✕
          </button>
        </div>

        {/* ── Loading state ────────────────────────────────────────────────── */}
        {loading && (
          <p className="text-sm text-fg-muted" role="status">
            Loading…
          </p>
        )}

        {/* ── Loaded content ───────────────────────────────────────────────── */}
        {!loading && data && (
          <>
            {/* Status badge + total grade (teacher-only; raw numbers allowed). */}
            <div className="flex items-center gap-3">
              <span className="rounded-md border-2 border-sidebar-edge bg-brand-surface px-2 py-0.5 text-xs font-bold text-fg">
                {STATUS_LABEL[data.status] ?? data.status}
              </span>
              {data.total_grade != null && data.total_max != null && (
                <span className="text-sm font-bold text-fg">
                  {data.total_grade} / {data.total_max}
                </span>
              )}
            </div>

            {/* ── Per-section collapsible rows ──────────────────────────────── */}
            <div className="flex flex-col gap-2">
              {data.sections.map((section) => {
                // Section-level grade = sum of individual question grades.
                const sectionGrade = section.questions.reduce(
                  (acc, q) => acc + (q.grade ?? 0),
                  0,
                );
                const isExpanded = expanded.has(section.section_order);

                return (
                  <div
                    key={section.section_order}
                    className="rounded-lg border-2 border-sidebar-edge bg-surface"
                  >
                    {/* Section header — click to toggle expand/collapse. */}
                    <button
                      type="button"
                      onClick={() => toggleSection(section.section_order)}
                      aria-expanded={isExpanded}
                      className="flex w-full items-center justify-between p-3 text-left font-bold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <span>{section.title}</span>
                      {/* Section-level grade in the collapsed header. */}
                      <span className="text-sm font-normal text-fg-muted">
                        {sectionGrade} / {section.total_points}
                      </span>
                    </button>

                    {/* Expanded body: per-question rows. */}
                    {isExpanded && (
                      <div className="flex flex-col gap-3 border-t-2 border-sidebar-edge p-3">
                        {section.questions.map((q) => (
                          <div
                            key={q.question_order}
                            className="flex flex-col gap-1"
                          >
                            <p className="text-sm font-bold text-fg">
                              {q.question_text}
                            </p>
                            {q.response_text ? (
                              <p className="whitespace-pre-wrap text-sm text-fg">
                                {q.response_text}
                              </p>
                            ) : (
                              <p className="text-sm text-fg-muted">
                                No response.
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-fg">
                                {q.grade ?? 0} / {q.points}
                              </span>
                              {q.ai_feedback && (
                                <span className="text-xs text-fg-muted">
                                  {q.ai_feedback}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Empty state when no sections returned. */}
            {data.sections.length === 0 && (
              <p className="text-sm text-fg-muted">
                No questions generated for this student yet.
              </p>
            )}
          </>
        )}

        {/* Error / null state after fetch. */}
        {!loading && !data && (
          <p className="text-sm text-fg-muted">
            Couldn&apos;t load the breakdown — try again in a moment.
          </p>
        )}
      </aside>
    </>
  );
}

export default ChapterTestDrillIn;
