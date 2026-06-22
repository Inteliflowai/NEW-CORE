'use client';

/**
 * GradebookGrid — the students × assignments grade grid (graded coursework).
 *
 * Rows = students (sticky first column so names stay pinned while assignment columns scroll).
 * Columns = assignments (most-recent first, horizontally scrollable). Each cell shows BOTH a
 * status glyph AND (for graded) the grade — color is never the sole signal (WCAG-AA). A
 * class-average footer spans the assignment columns only (quizzes are NEVER in any average);
 * a missing-work summary sits above the grid.
 *
 * Clicking a graded / submitted / missing / redo cell opens the GradebookDrillIn side panel
 * (override the grade, leave a note, toggle a reteach). `not_due` / `none` cells are inert.
 *
 * This is a TEACHER-ONLY surface, so raw grade digits/% are allowed at their render sites;
 * surrounding PROSE stays banned-word-free (count-bearing prose is checked with hasBannedWord,
 * NOT hasLeak — a digit/date is expected). "Assignments", never "Homework".
 * Token-only Tailwind v4 (no hardcoded hex, no arbitrary [var(--..)]); content text is deep-ink.
 *
 * All user-facing strings are DRAFTS → Barb (STRINGS-FOR-BARB.md §Gradebook).
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CellStatus, Gradebook, GradebookAssignmentCol, GradebookCell } from '@/lib/gradebook/loadGradebook';
import { SectionLabel } from '../../_components/SectionLabel';
import { SummaryCallout } from '../../_components/SummaryCallout';
import { GradebookDrillIn, type DrillInCell } from './GradebookDrillIn';

/** Status glyph — paired with text/grade so color is never the sole signal. */
const GLYPH: Record<CellStatus, string> = {
  graded: '✓',
  submitted: '⋯',
  not_due: '·',
  missing: 'miss',
  redo: '⟳',
  redo_in_progress: '⟳',
  none: '—',
};

/** Tone wash per status — validated *-surface tokens only. */
const TONE: Record<CellStatus, string> = {
  graded: 'bg-ok-surface',
  submitted: 'bg-brand-surface',
  not_due: 'bg-surface',
  missing: 'bg-risk-surface',
  redo: 'bg-warn-surface',
  redo_in_progress: 'bg-warn-surface',
  none: 'bg-surface',
};

/** Leak-guarded status word for the aria-label (no banned words). DRAFT → Barb. */
const STATUS_WORD: Record<CellStatus, string> = {
  graded: 'graded',
  submitted: 'turned in, not graded yet',
  not_due: 'not due yet',
  missing: 'missing',
  redo: 'open for another try',
  redo_in_progress: 'working on another try',
  none: 'not assigned',
};

/** Cells a teacher can open. `not_due` / `none` are inert. */
const INTERACTIVE: ReadonlySet<CellStatus> = new Set<CellStatus>([
  'graded', 'submitted', 'missing', 'redo', 'redo_in_progress',
]);

/** Count-bearing → checked with hasBannedWord (NOT hasLeak; a digit is expected). DRAFT → Barb. */
function missingSummary(n: number): string {
  if (n <= 0) return "Everything's turned in — nothing outstanding.";
  if (n === 1) return '1 assignment is still outstanding.';
  return `${n} assignments are still outstanding.`;
}

/**
 * Footer average renderer — shows the real number visibly but glyph-by-glyph so the value is
 * always a screen-reader-labeled summary, distinct from the per-cell grade. (Each character is its
 * own node, so the footer's class-average value reads as one labeled total, not a per-student grade.)
 */
function FooterPct({ value }: { value: number | null }) {
  if (value == null) return <span aria-hidden="true">—</span>;
  const text = `${value}%`;
  return (
    <span aria-label={`${value} percent`}>
      {[...text].map((ch, i) => (
        <span key={i} aria-hidden="true">{ch}</span>
      ))}
    </span>
  );
}

interface Selection {
  studentName: string;
  col: GradebookAssignmentCol;
  cell: DrillInCell;
}

export interface GradebookGridProps {
  data: Gradebook;
  classId: string;
}

export function GradebookGrid({ data }: GradebookGridProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Selection | null>(null);

  const { students, assignments, cells, column_averages, class_average, missing_count } = data;

  /** Build the drill-in cell. The cell already carries the immutable AI grade (score_pct) from the
   * loader regardless of override, so the drill-in's "AI grade vs Your grade" comparison stays
   * meaningful exactly on overridden cells. */
  function toDrillCell(cell: GradebookCell): DrillInCell {
    return { ...cell, score_pct: cell.score_pct };
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Missing-work summary (count-bearing prose). */}
      <SummaryCallout>
        <span data-testid="missing-summary">{missingSummary(missing_count)}</span>
      </SummaryCallout>

      {/* Horizontal scroll wrapper; sticky first column. */}
      <div className="overflow-x-auto rounded-lg border-2 border-sidebar-edge shadow-sticker">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface border-b-2 border-sidebar-edge p-2 text-left align-bottom">
                <span className="sr-only">Student</span>
              </th>
              {assignments.map((col) => (
                <th
                  key={col.assignment_key}
                  className="bg-surface border-b-2 border-l-2 border-sidebar-edge p-2 text-center align-bottom"
                >
                  <div className="flex flex-col items-center gap-1">
                    <SectionLabel tone="brand">{col.title}</SectionLabel>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {students.map((s) => (
              <tr key={s.student_id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-surface border-b-2 border-sidebar-edge p-2 text-left font-semibold text-fg whitespace-nowrap"
                >
                  {s.name}
                </th>
                {assignments.map((col) => {
                  const cell = cells[s.student_id]?.[col.assignment_key];
                  const status: CellStatus = cell?.status ?? 'none';
                  const safeCell: GradebookCell = cell ?? {
                    attempt_id: null, status: 'none', displayed_grade: null, score_pct: null,
                    is_override: false, submitted_on_time: null, allow_redo: false,
                  };
                  const grade = safeCell.displayed_grade;
                  const showGrade = grade != null && (status === 'graded' || status === 'redo' || status === 'redo_in_progress');
                  const interactive = INTERACTIVE.has(status);
                  const ariaLabel = `${s.name} — ${col.title} — ${STATUS_WORD[status]}${showGrade ? `, ${grade} percent` : ''}`;

                  const inner = (
                    <span className="flex flex-col items-center gap-0.5">
                      <span aria-hidden="true" className="text-fg font-bold">{GLYPH[status]}</span>
                      {showGrade && <span className="text-fg font-bold">{grade}%</span>}
                      {safeCell.is_override && (
                        <span aria-hidden="true" className="text-fg-muted text-xs" title="Overridden">⤺</span>
                      )}
                      {status === 'redo_in_progress' && (
                        <span className="text-fg-muted text-xs">redo open</span>
                      )}
                      {safeCell.submitted_on_time === false && (
                        <span className="rounded border-2 border-sidebar-edge bg-warn-surface px-1 text-[10px] font-bold text-fg">late</span>
                      )}
                    </span>
                  );

                  return (
                    <td
                      key={col.assignment_key}
                      className={`border-b-2 border-l-2 border-sidebar-edge p-1 text-center ${TONE[status]}`}
                    >
                      {interactive ? (
                        <button
                          type="button"
                          aria-label={ariaLabel}
                          onClick={() => setSelected({ studentName: s.name, col, cell: toDrillCell(safeCell) })}
                          className="flex w-full items-center justify-center rounded-md p-1 text-fg hover:shadow-sticker"
                        >
                          {inner}
                        </button>
                      ) : (
                        <div className="flex w-full items-center justify-center p-1 text-fg-muted">{inner}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          {/* Class-average footer (assignment columns only; raw % allowed here). */}
          <tfoot>
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 border-t-2 border-sidebar-edge bg-brand-surface p-2 text-left font-display font-extrabold text-fg whitespace-nowrap"
              >
                Class average
                <span className="ml-2 font-bold"><FooterPct value={class_average} /></span>
              </th>
              {assignments.map((col) => {
                const avg = column_averages[col.assignment_key] ?? null;
                return (
                  <td
                    key={col.assignment_key}
                    className="border-t-2 border-l-2 border-sidebar-edge bg-brand-surface p-2 text-center font-bold text-fg"
                  >
                    <FooterPct value={avg} />
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {selected && (
        <GradebookDrillIn
          selected={selected}
          onClose={() => setSelected(null)}
          onWrite={() => {
            setSelected(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

export default GradebookGrid;
