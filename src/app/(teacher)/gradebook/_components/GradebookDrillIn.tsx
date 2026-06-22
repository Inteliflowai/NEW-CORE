'use client';

/**
 * GradebookDrillIn — the click-a-cell side panel for a single (student, assignment) attempt.
 *
 * Opened by GradebookGrid (Task 4) when a graded/redo/missing cell is clicked. All read data
 * arrives in props (no extra fetch for the read). The teacher can:
 *   - override the grade (writes teacher_score; override-wins is teacher_score ?? score_pct),
 *   - leave a note (teacher_notes),
 *   - clear the override (teacher_score = null → reverts to the AI grade),
 *   - open the assignment for another try (allow_redo — the reteach toggle).
 * All writes go through POST /api/teacher/gradebook/override (the route re-checks the auth chain
 * + IDOR; the client cannot be trusted). On a 200, onWrite() lets the grid router.refresh().
 *
 * This is a TEACHER-ONLY surface, so raw grade digits/% are allowed at their render sites; all
 * surrounding PROSE stays banned-word-free (leakGuard.ts). "Assignments", never "Homework".
 * Token-only Tailwind v4 (no hardcoded hex, no arbitrary [var(--..)]); content text is deep-ink.
 *
 * All user-facing strings are DRAFTS → Barb (STRINGS-FOR-BARB.md §Gradebook).
 */

import React, { useState } from 'react';
import type { GradebookCell, GradebookAssignmentCol } from '@/lib/gradebook/loadGradebook';
import { effortLabelPhrase } from '@/lib/copy/effortLabelPhrase';
import type { EffortLabel } from '@/lib/signals/computeEffortLabel';

/** The grid passes the cell plus the immutable AI grade (score_pct) and the optional effort label. */
export interface DrillInCell extends GradebookCell {
  score_pct: number | null;
  effort_label?: EffortLabel | null;
}

export interface GradebookDrillInSelection {
  studentName: string;
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
  submitted: 'Turned in — not graded yet',
  not_due: 'Not due yet',
  missing: 'Missing',
  redo: 'Open for another try',
  redo_in_progress: 'Working on another try',
  none: 'Not assigned',
};

export function GradebookDrillIn({ selected, onClose, onWrite }: GradebookDrillInProps) {
  const { studentName, col, cell } = selected;

  const [gradeInput, setGradeInput] = useState<string>(
    cell.is_override && cell.displayed_grade != null ? String(cell.displayed_grade) : '',
  );
  const [notes, setNotes] = useState<string>('');
  const [allowRedo, setAllowRedo] = useState<boolean>(cell.allow_redo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canOverride = cell.attempt_id != null;
  const effortPhrase = cell.effort_label ? effortLabelPhrase(cell.effort_label) : null;

  async function post(patch: Record<string, unknown>) {
    if (!cell.attempt_id || busy) return;
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
        return;
      }
      onWrite();
    } catch {
      setError("That didn't save — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  function onSave() {
    const trimmed = gradeInput.trim();
    const score = trimmed === '' ? null : Number(trimmed);
    const patch: Record<string, unknown> = { teacher_score: score };
    if (notes.trim() !== '') patch.teacher_notes = notes.trim();
    void post(patch);
  }

  function onClear() {
    setGradeInput('');
    void post({ teacher_score: null });
  }

  function onToggleRedo() {
    const next = !allowRedo;
    setAllowRedo(next);
    void post({ allow_redo: next });
  }

  return (
    <aside
      role="dialog"
      aria-label={`${studentName} — ${col.title}`}
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l-2 border-sidebar-edge bg-surface p-5 shadow-sticker-lg"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-extrabold text-fg">{studentName}</h2>
          <p className="text-sm text-fg">{col.title}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md border-2 border-sidebar-edge px-2 py-1 text-fg shadow-sticker"
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

      {/* Effort line — only shown when an effort label is available */}
      {effortPhrase && <p className="text-sm text-fg-muted">{effortPhrase}</p>}

      {/* Override control (assignments only — an attempt must exist) */}
      {canOverride && (
        <div className="flex flex-col gap-3 border-t-2 border-sidebar-edge pt-4">
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
              className="w-24 rounded-md border-2 border-sidebar-edge bg-bg px-2 py-1 text-fg"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="override-notes" className="text-sm font-bold text-fg">
              Add a note
            </label>
            <textarea
              id="override-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
              className="min-h-[60px] w-full resize-none rounded-md border-2 border-sidebar-edge bg-bg px-2 py-1 text-fg"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-bold text-fg-on-brand shadow-sticker disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={busy}
              className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 text-fg shadow-sticker disabled:opacity-50"
            >
              Clear override
            </button>
          </div>

          {/* Reteach toggle */}
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={allowRedo}
              onChange={onToggleRedo}
              disabled={busy}
            />
            Open this for another try.
          </label>

          {error && (
            <p role="alert" className="text-sm text-fg">
              {error}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

export default GradebookDrillIn;
