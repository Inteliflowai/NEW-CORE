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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
/** How many of the most-recent dated columns the grid shows before "Show earlier". */
export const DEFAULT_VISIBLE_COLS = 12;

/** Pure, testable tooltip lines for a grade cell (assignment name + dates). Count-bearing prose →
 *  banned-word-free (dates are expected). DRAFT → Barb. */
export function cellTooltipLines(col: GradebookAssignmentCol, cell: GradebookCell): string[] {
  const lines: string[] = [col.title];
  if (cell.submitted_at) {
    const late = cell.submitted_on_time === false;
    lines.push(`Turned in ${shortDate(cell.submitted_at)}${late ? ' (late)' : ' (on time)'}`);
  } else {
    lines.push('Not turned in yet');
  }
  if (col.due_at) lines.push(`Due ${shortDate(col.due_at)}`);
  return lines;
}

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

/** Glyph legend rows — recognition-over-recall (B-U2). Leak-guarded words. DRAFT → Barb. */
const LEGEND: ReadonlyArray<{ glyph: string; word: string }> = [
  { glyph: '✓', word: 'graded' },
  { glyph: '⋯', word: 'turned in' },
  { glyph: '·', word: 'not due' },
  { glyph: 'miss', word: 'missing' },
  { glyph: '⟳', word: 'another try' },
  { glyph: '⤺', word: 'grade changed' },
  { glyph: 'late', word: 'turned in late' },
];

function GlyphLegend() {
  return (
    <ul
      data-testid="glyph-legend"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted"
    >
      {LEGEND.map(({ glyph, word }) => (
        <li key={word} className="flex items-center gap-1">
          <span aria-hidden="true" className="font-bold text-fg">{glyph}</span>
          <span>{word}</span>
        </li>
      ))}
    </ul>
  );
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
  studentId: string;
  classId: string;
  col: GradebookAssignmentCol;
  cell: DrillInCell;
}

export interface GradebookGridProps {
  data: Gradebook;
}

export function GradebookGrid({ data }: GradebookGridProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Selection | null>(null);

  const { students, assignments, cells, column_averages, class_average, missing_count } = data;

  const [showAll, setShowAll] = useState(false);
  const hasEarlier = assignments.length > DEFAULT_VISIBLE_COLS;
  // assignments arrive chronological asc; default shows the most-recent window (the tail).
  const visibleCols = showAll ? assignments : assignments.slice(-DEFAULT_VISIBLE_COLS);
  // Single fixed-position tooltip (avoids clipping inside the scroll container).
  const [tip, setTip] = useState<{ lines: string[]; x: number; y: number } | null>(null);

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

      {/* Glyph legend (recognition-over-recall). */}
      <GlyphLegend />

      {hasEarlier && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {showAll ? 'Show recent only' : 'Show earlier'}
        </button>
      )}

      {/* Scroll wrapper — capped height so the sticky header row stays visible with a long roster.
          Sticky first column (left) + sticky header row (top); the top-left corner sits above both. */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border-2 border-sidebar-edge shadow-sticker">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-surface border-b-2 border-sidebar-edge p-2 text-left align-bottom">
                <span className="sr-only">Student</span>
              </th>
              {visibleCols.map((col) => (
                <th
                  key={col.assignment_key}
                  className="sticky top-0 z-20 bg-surface border-b-2 border-l-2 border-sidebar-edge p-2 text-center align-bottom"
                >
                  <div className="flex flex-col items-center gap-1">
                    <SectionLabel tone="brand">{col.title}</SectionLabel>
                    <span className="text-[10px] text-fg-muted whitespace-nowrap">
                      {col.assigned_at ? `Assigned ${shortDate(col.assigned_at)}` : ''}
                      {col.assigned_at && col.due_at ? ' · ' : ''}
                      {col.due_at ? `Due ${shortDate(col.due_at)}` : ''}
                    </span>
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
                {visibleCols.map((col) => {
                  const cell = cells[s.student_id]?.[col.assignment_key];
                  const status: CellStatus = cell?.status ?? 'none';
                  const safeCell: GradebookCell = cell ?? {
                    attempt_id: null, status: 'none', displayed_grade: null, score_pct: null,
                    effort_label: null, teacher_notes: null, submitted_at: null,
                    is_override: false, submitted_on_time: null, allow_redo: false,
                  };
                  const grade = safeCell.displayed_grade;
                  const showGrade = grade != null && (status === 'graded' || status === 'redo' || status === 'redo_in_progress');
                  const interactive = INTERACTIVE.has(status);
                  // Tooltip lines (assignment name + submitted/due dates), reused as the SR path so
                  // keyboard/AT users get the same dates the hover/focus tooltip shows the sighted user.
                  const tipLines = cellTooltipLines(col, safeCell);
                  // B-A1: fold cell state + the tooltip's date detail into the accessible name (banned-word-free).
                  const stateSuffix =
                    (showGrade ? `, ${grade} percent` : '')
                    + (safeCell.submitted_on_time === false ? ', late' : '')
                    + (safeCell.is_override ? ', grade changed by teacher' : '')
                    + (status === 'redo_in_progress' ? ', redo open' : '');
                  const ariaLabel = `${s.name} — ${col.title} — ${STATUS_WORD[status]}${stateSuffix}`
                    + tipLines.slice(1).map((l) => `, ${l}`).join('');

                  const inner = (
                    <span className="flex flex-col items-center gap-0.5">
                      <span aria-hidden="true" className="text-fg font-bold">{GLYPH[status]}</span>
                      {/* B-U6: a visible word beside the bare ⋯ glyph for a turned-in cell. */}
                      {status === 'submitted' && (
                        <span className="text-fg-muted text-xs">in</span>
                      )}
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
                          onMouseEnter={(e) => setTip({ lines: tipLines, x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setTip(null)}
                          onFocus={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setTip({ lines: tipLines, x: r.left + r.width / 2, y: r.top });
                          }}
                          onBlur={() => setTip(null)}
                          // WCAG 1.4.13 Dismissible: Escape hides the tooltip without moving focus.
                          onKeyDown={(e) => { if (e.key === 'Escape') setTip(null); }}
                          onClick={() => setSelected({ studentName: s.name, studentId: s.student_id, classId: data.class_id, col, cell: toDrillCell(safeCell) })}
                          className="flex w-full cursor-pointer items-center justify-center rounded-md p-1 text-fg ring-1 ring-sidebar-edge/40 hover:shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
              {visibleCols.map((col) => {
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

      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-40 max-w-xs -translate-x-1/2 -translate-y-full rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1 text-xs text-fg shadow-sticker"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.lines.map((l, i) => (
            <div key={i} className={i === 0 ? 'font-bold' : ''}>{l}</div>
          ))}
        </div>
      )}

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
