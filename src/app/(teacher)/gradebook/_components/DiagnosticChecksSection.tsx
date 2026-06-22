/**
 * DiagnosticChecksSection — the read-only "Diagnostic checks — not graded" quiz grid.
 *
 * A separate, visually-distinct block BELOW the graded grid so a teacher can never confuse a
 * diagnostic with graded coursework. Quizzes are NEVER counted in any average (they live entirely
 * outside the GradebookGrid's class-average). This section is READ-ONLY: no override input, no
 * reteach toggle — diagnostics are coached, not graded.
 *
 * Four-audience discipline: this is a TEACHER-ONLY surface, so raw `score_pct` digits are allowed
 * at their render sites — but the raw `mastery_band` enum ('reteach'/'grade_level'/'advanced') is
 * NEVER rendered directly. It always goes through the teacher-safe MasteryLabel (band prop), which
 * humanizes it. Surrounding prose stays leak-guarded. "Assignments", never "Homework".
 *
 * Tone vocabularies do NOT mix: Card tone='surface' (wrapper) + SectionLabel tone='lime' (label) so
 * the section reads as a different "kind" from the cobalt assignment grid. Token-only Tailwind v4
 * (no hardcoded hex, no arbitrary [var(--..)]); content text is deep-ink.
 *
 * All user-facing strings are DRAFTS → Barb (STRINGS-FOR-BARB.md §Gradebook).
 */

import React from 'react';
import type { Gradebook } from '@/lib/gradebook/loadGradebook';
import { Card } from '@/components/core/Card';
import { MasteryLabel } from '@/components/core/MasteryLabel';
import { SectionLabel } from '../../_components/SectionLabel';

export interface DiagnosticChecksSectionProps {
  data: Gradebook;
}

export function DiagnosticChecksSection({ data }: DiagnosticChecksSectionProps) {
  const { students, quizzes, quiz_cells } = data;

  return (
    <Card tone="surface" className="flex flex-col gap-4">
      {/* Full-width divider sets this section apart from the graded grid above. */}
      <hr className="border-t-2 border-sidebar-edge" />

      <div className="flex flex-col gap-2">
        <SectionLabel tone="lime">Diagnostic checks — not graded</SectionLabel>
        {/* Number-free prose → passes BOTH leak guards. DRAFT → Barb. */}
        <p className="text-fg text-sm">
          These checks help you see where students are — they don&apos;t count toward grades.
        </p>
      </div>

      {quizzes.length === 0 ? (
        <p className="text-fg-muted text-sm">No diagnostic checks yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border-2 border-sidebar-edge shadow-sticker">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-surface border-b-2 border-sidebar-edge p-2 text-left align-bottom">
                  <span className="sr-only">Student</span>
                </th>
                {quizzes.map((q) => (
                  <th
                    key={q.quiz_id}
                    className="bg-surface border-b-2 border-l-2 border-sidebar-edge p-2 text-center align-bottom"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <SectionLabel tone="lime">{q.label}</SectionLabel>
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
                  {quizzes.map((q) => {
                    const cell = quiz_cells[s.student_id]?.[q.quiz_id];
                    if (!cell || !cell.quiz_attempt_id) {
                      return (
                        <td
                          key={q.quiz_id}
                          className="border-b-2 border-l-2 border-sidebar-edge p-2 text-center text-fg-muted"
                        >
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">not taken</span>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={q.quiz_id}
                        className="border-b-2 border-l-2 border-sidebar-edge p-2 text-center"
                      >
                        <span className="flex flex-col items-center gap-1">
                          {/* Completion glyph — paired with text so color is never the sole signal. */}
                          <span className="text-fg text-xs">
                            <span aria-hidden="true">{cell.is_complete ? '●' : '○'}</span>{' '}
                            {cell.is_complete ? 'done' : 'in progress'}
                          </span>
                          {/* Raw score digits allowed at this teacher render site. */}
                          {cell.score_pct != null && (
                            <span className="text-fg font-bold">{cell.score_pct}%</span>
                          )}
                          {/* Raw mastery_band enum NEVER rendered directly — always via MasteryLabel. */}
                          <MasteryLabel band={cell.mastery_band} />
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default DiagnosticChecksSection;
