'use client';

/**
 * GradebookDrillIn — the click-a-cell side panel for a single (student, assignment) attempt.
 *
 * Opened by GradebookGrid (Task 4) when an interactive cell is clicked. All read data arrives in
 * props (no extra fetch for the read). What a teacher can do depends on the cell's status:
 *   - graded / redo / redo_in_progress → override the grade (teacher_score), leave/clear a note
 *     (teacher_notes), clear the override (teacher_score = null → reverts to the AI grade),
 *     and open the assignment for another try (allow_redo — the reteach toggle).
 *   - submitted (turned in, not graded yet) → leave/clear a note only; NO grade input (the route
 *     409s a grade override on a non-graded attempt — showing the input would mislead).
 *   - missing / not_due / none (no attempt) → an explanatory empty-state; NO write controls.
 * All writes go through POST /api/teacher/gradebook/override (the route re-checks the auth chain
 * + IDOR; the client cannot be trusted). On a 200, onWrite() lets the grid router.refresh().
 *
 * This is a TEACHER-ONLY surface, so raw grade digits/% are allowed at their render sites; all
 * surrounding PROSE stays banned-word-free (leakGuard.ts). "Assignments", never "Homework".
 * Token-only Tailwind v4 (no hardcoded hex, no arbitrary [var(--..)]); content text is deep-ink.
 *
 * All user-facing strings are DRAFTS → Barb (STRINGS-FOR-BARB.md §Gradebook).
 */

import React, { useEffect, useRef, useState } from 'react';
import type { GradebookCell, GradebookAssignmentCol } from '@/lib/gradebook/loadGradebook';
import { effortLabelPhrase } from '@/lib/copy/effortLabelPhrase';
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import type { StudentGradeTrend } from '@/lib/gradebook/loadStudentGradeTrend';
import { MathText } from '@/components/core/MathText';

/** The drill-in renders the loader's GradebookCell verbatim — it already carries the immutable
 * AI grade (score_pct), the effort label, the teacher note and the submission date. */
export type DrillInCell = GradebookCell;

export interface GradebookDrillInSelection {
  studentName: string;
  studentId: string;
  classId: string;
  col: GradebookAssignmentCol;
  cell: DrillInCell;
}

export interface GradebookDrillInProps {
  selected: GradebookDrillInSelection;
  onClose: () => void;
  onWrite: () => void;
}

/** Teacher-safe status microcopy (number-free, banned-word-free). DRAFT → Barb. */
const STATUS_WORD: Record<GradebookCell['status'], string> = {
  graded: 'Graded',
  submitted: 'Turned in, waiting on a grade',
  not_due: 'Not due yet',
  missing: 'Missing',
  redo: 'Open for another try',
  redo_in_progress: 'Working on another try',
  none: 'Not assigned',
};

/** Statuses where a grade exists to override (the route only accepts a grade override on a
 * `graded` attempt; redo / redo_in_progress carry the prior graded attempt's id). */
const GRADED_FAMILY: ReadonlySet<GradebookCell['status']> = new Set<GradebookCell['status']>([
  'graded', 'redo', 'redo_in_progress',
]);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Date-only, banned-word-free (count-bearing prose → hasBannedWord, not hasLeak). DRAFT → Barb. */
function submittedDateLabel(iso: string): string {
  const d = new Date(iso);
  return `Turned in ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Plain-language grade-trend direction (banned-word-free; no band/risk). DRAFT → Barb. */
function trendDirectionPhrase(d: StudentGradeTrend['direction']): string {
  if (d === 'climbing') return 'Climbing over the last few.';
  if (d === 'sliding') return 'Slipping a little lately.';
  if (d === 'steady') return 'Holding steady lately.';
  return 'Grades over time';
}

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

interface AttemptWork {
  tasks: { step: number; description: string }[];
  responses: { tasks: Record<string, { text?: string; image_url?: string | null }> };
  ai_feedback: { overall?: string } | null;
  status: string;
}

export function GradebookDrillIn({ selected, onClose, onWrite }: GradebookDrillInProps) {
  const { studentName, studentId, classId, col, cell } = selected;

  // This student's grade-over-time trend (class-scoped, teacher-only earned grades). Fetched on open
  // via the auth-guarded route; null until it resolves (or on error → no sparkline section).
  const [trend, setTrend] = useState<StudentGradeTrend | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/teacher/gradebook/trend?studentId=${encodeURIComponent(studentId)}&classId=${encodeURIComponent(classId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => { if (live) setTrend(t); })
      .catch(() => { if (live) setTrend(null); });
    return () => { live = false; };
  }, [studentId, classId]);

  const [work, setWork] = useState<AttemptWork | null>(null);
  const [expandedImg, setExpandedImg] = useState<string | null>(null);

  useEffect(() => {
    if (!cell.attempt_id) { setWork(null); return; }
    let live = true;
    fetch(`/api/teacher/gradebook/attempt?attemptId=${encodeURIComponent(cell.attempt_id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => { if (live) setWork(w); })
      .catch(() => { if (live) setWork(null); });
    return () => { live = false; };
  }, [cell.attempt_id]);

  // Esc closes the enlarged-drawing overlay (it renders outside the panel's focus trap).
  useEffect(() => {
    if (!expandedImg) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedImg(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expandedImg]);

  const isGradedFamily = GRADED_FAMILY.has(cell.status);
  // A grade override needs a graded attempt; a note needs ANY attempt (submitted included).
  const canEditGrade = isGradedFamily && cell.attempt_id != null;
  const canEditNote = cell.attempt_id != null;
  // Finding 2: you can't reteach work that isn't graded yet — gate the toggle on the graded family
  // (the same statuses that show the grade input). A `submitted` (ungraded) cell is notes-only.
  const canReteach = isGradedFamily && cell.attempt_id != null;

  const [gradeInput, setGradeInput] = useState<string>(
    cell.is_override && cell.displayed_grade != null ? String(cell.displayed_grade) : '',
  );
  const [notes, setNotes] = useState<string>(cell.teacher_notes ?? '');
  const [allowRedo, setAllowRedo] = useState<boolean>(cell.allow_redo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effortPhrase = cell.effort_label ? effortLabelPhrase(cell.effort_label) : null;

  // Keyboard a11y: trap focus inside the panel, restore focus to the originating cell button on
  // every close path, and close on Escape (M4 / B-A2).
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Capture the element that had focus when the panel opened (the cell button).
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    closeRef.current?.focus();
    return () => {
      // Restore focus on unmount (covers every close path: Escape, ✕, Save→onWrite, Clear, scrim).
      triggerRef.current?.focus?.();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      const root = panelRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => !n.hasAttribute('disabled'),
      );
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

  async function post(patch: Record<string, unknown>): Promise<boolean> {
    if (!cell.attempt_id || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/teacher/gradebook/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempt_id: cell.attempt_id, ...patch }),
      });
      if (!res.ok) {
        setError("That didn't save — try again in a moment.");
        return false;
      }
      return true;
    } catch {
      setError("That didn't save — try again in a moment.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onSave() {
    // The note is always sent ('' → null) so a teacher can view, edit AND CLEAR it (B-U5).
    const trimmedNote = notes.trim();
    const patch: Record<string, unknown> = { teacher_notes: trimmedNote === '' ? null : trimmedNote };

    if (canEditGrade) {
      // Finding 1: a graded cell with no override starts with a BLANK grade input. A blank grade
      // means "no grade change" — send no teacher_score (so a note-only edit still saves), and do
      // NOT error. Clearing an existing override stays the explicit separate "Clear override".
      // Guard only NON-empty invalid input.
      const trimmed = gradeInput.trim();
      if (trimmed !== '') {
        const score = Number(trimmed);
        if (!Number.isFinite(score) || score < 0 || score > 100) {
          setError('Enter a grade from 0 to 100, or use Clear override.');
          return;
        }
        patch.teacher_score = score;
      }
    }

    void post(patch).then((ok) => {
      if (ok) onWrite();
    });
  }

  function onClear() {
    setGradeInput('');
    void post({ teacher_score: null }).then((ok) => {
      if (ok) onWrite();
    });
  }

  function onToggleRedo() {
    // B-C2: flip optimistically, but capture the prior value and REVERT on a failed/throwing POST
    // (or only commit on success). Never leave the checkbox out of sync with the server.
    const prev = allowRedo;
    const next = !prev;
    setAllowRedo(next);
    void post({ allow_redo: next }).then((ok) => {
      if (!ok) setAllowRedo(prev); // rollback
    });
  }

  return (
    <>
      {/* Click-outside-to-close scrim (B-A2). Token-only; inert to screen readers. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-20 bg-fg/30"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${studentName} — ${col.title}`}
        onKeyDown={onKeyDown}
        className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l-2 border-sidebar-edge bg-surface p-5 shadow-sticker-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-extrabold text-fg">{studentName}</h2>
            <p className="text-sm text-fg">{col.title}</p>
            {cell.submitted_at && (
              <p data-testid="submitted-date" className="text-xs text-fg-muted">
                {submittedDateLabel(cell.submitted_at)}
              </p>
            )}
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

        {/* Status line — glyph + word, never colour alone */}
        <p className="text-sm text-fg">
          <span aria-hidden="true" className="mr-1">
            {cell.status === 'graded' ? '✓' : cell.status === 'missing' ? '•' : '·'}
          </span>
          {STATUS_WORD[cell.status]}
          {cell.submitted_on_time === false && (
            <span className="ml-2 rounded-md border-2 border-sidebar-edge bg-warn-surface px-1.5 py-0.5 text-xs font-bold text-fg">
              Late
            </span>
          )}
        </p>

        {/* Grade breakdown — AI grade vs the teacher's override (teacher-only render site) */}
        {cell.is_override ? (
          <div className="flex flex-col gap-1 rounded-lg border-2 border-sidebar-edge bg-brand-surface p-3">
            <p className="text-sm text-fg">
              <span className="font-bold">AI grade:</span>{' '}
              {cell.score_pct != null ? `${cell.score_pct}%` : '—'}
            </p>
            <p className="text-sm text-fg">
              <span className="font-bold">Your grade:</span>{' '}
              {cell.displayed_grade != null ? `${cell.displayed_grade}%` : '—'}
            </p>
          </div>
        ) : (
          cell.displayed_grade != null && (
            <p className="text-sm text-fg">
              <span className="font-bold">AI grade:</span> {cell.displayed_grade}%
            </p>
          )
        )}

        {/* Grade trend — this student's graded assignments over time (teacher-only; earned grades). */}
        {trend && Array.isArray(trend.points) && (
          <div className="flex flex-col gap-1 border-t-2 border-sidebar-edge pt-4">
            <p className="text-sm font-bold text-fg">{trendDirectionPhrase(trend.direction)}</p>
            <GradeTrendSparkline
              size="sm"
              points={trend.points.map((p) => ({ date: p.date, grade: p.grade, label: `${p.assignment_title} · ${p.grade}%` }))}
              ariaLabel={`${studentName}'s grades over time${trend.latest != null ? `, latest ${trend.latest} percent` : ''}`}
              coldStartLabel="Not enough graded work yet to show a trend."
            />
          </div>
        )}

        {/* Effort line — only shown when an effort label is available */}
        {effortPhrase && <p className="text-sm text-fg-muted">{effortPhrase}</p>}

        {/* Student's work — the actual submitted answers + drawings (teacher-only; fetched on open). */}
        {work && work.tasks?.length > 0 && (
          <section className="flex flex-col gap-3 border-t-2 border-sidebar-edge pt-4">
            <h3 className="font-display text-sm font-extrabold uppercase tracking-wide text-fg">Student&apos;s work</h3>
            {work.tasks.map((t) => {
              const r = work.responses?.tasks?.[String(t.step)] ?? {};
              const text = (r.text ?? '').trim();
              const img = r.image_url ?? null;
              return (
                <div key={t.step} className="flex flex-col gap-1">
                  <div className="text-sm font-bold text-fg"><MathText>{t.description}</MathText></div>
                  {text ? (
                    <p className="whitespace-pre-wrap text-sm text-fg">{text}</p>
                  ) : !img ? (
                    <p className="text-sm text-fg-muted">No written answer.</p>
                  ) : null}
                  {img && (
                    <button
                      type="button"
                      onClick={() => setExpandedImg(img)}
                      aria-label={`Enlarge the drawing for question ${t.step}`}
                      className="self-start rounded-md border-2 border-sidebar-edge bg-bg p-1 shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <img src={img} alt={`Drawing for question ${t.step}`} className="max-h-40 w-auto rounded" />
                    </button>
                  )}
                </div>
              );
            })}
            {work.ai_feedback?.overall && (
              <div className="rounded-lg border-2 border-sidebar-edge bg-brand-surface p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-fg-muted">What the AI noted</p>
                <p className="text-sm text-fg">{work.ai_feedback.overall}</p>
              </div>
            )}
          </section>
        )}

        {/* No-attempt empty-state: nothing to grade, no write controls (B-C1). */}
        {!canEditNote && (
          <p className="border-t-2 border-sidebar-edge pt-4 text-sm text-fg-muted">
            Nothing&apos;s been turned in yet — there&apos;s nothing to grade.
          </p>
        )}

        {/* Write controls — present whenever an attempt exists (grade input gated separately). */}
        {canEditNote && (
          <div className="flex flex-col gap-3 border-t-2 border-sidebar-edge pt-4">
            {/* Grade override — graded-family attempts only (B-C1). */}
            {canEditGrade ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="override-grade" className="text-sm font-bold text-fg">
                  Override grade
                </label>
                <input
                  id="override-grade"
                  type="number"
                  min={0}
                  max={100}
                  value={gradeInput}
                  onChange={(e) => setGradeInput(e.target.value)}
                  disabled={busy}
                  className="w-24 rounded-md border-2 border-sidebar-edge bg-bg px-2 py-1 text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                />
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Not graded yet — you can add a note.</p>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="override-notes" className="text-sm font-bold text-fg">
                Add a note
              </label>
              <textarea
                id="override-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={busy}
                className="min-h-[60px] w-full resize-none rounded-md border-2 border-sidebar-edge bg-bg px-2 py-1 text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onSave}
                disabled={busy}
                className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
              >
                Save
              </button>
              {canEditGrade && (
                <button
                  type="button"
                  onClick={onClear}
                  disabled={busy}
                  className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
                >
                  Clear override
                </button>
              )}
            </div>

            {/* Reteach toggle */}
            {canReteach && (
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={allowRedo}
                  onChange={onToggleRedo}
                  disabled={busy}
                  className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                />
                Open this for another try.
              </label>
            )}

            {error && (
              <p role="alert" className="text-sm text-fg">
                {error}
              </p>
            )}
          </div>
        )}
      </aside>
      {expandedImg && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Student drawing"
          onClick={() => setExpandedImg(null)}
          className="fixed inset-0 z-40 flex items-center justify-center bg-fg/60 p-6"
        >
          <img src={expandedImg} alt="Student drawing, enlarged" className="max-h-[90vh] max-w-[90vw] rounded-lg border-2 border-sidebar-edge bg-bg" />
        </div>
      )}
    </>
  );
}

export default GradebookDrillIn;
