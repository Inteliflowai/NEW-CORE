'use client';

/**
 * AssignmentResultScreen — the post-submit, GRADED result screen.
 *
 * Assignments are graded coursework that counts toward the class grade, so —
 * unlike the quiz runner's Option-D words-only screen — the student SEES the
 * grade (the percentage). The number is the ONE allow-listed carve-out: it
 * renders inside `data-testid="grade-display"` and is NOT passed through
 * assertNoLeak. EVERY other student-facing string (coach message, overall
 * feedback, per-task feedback) is built server-side by `assignmentResultBundle`
 * (double-guarded) and re-asserted here at the render boundary as a last line
 * of defense. Per-task NUMERIC grades (`task_grades[].grade`) are diagnostic and
 * NEVER reach the student — only the per-task prose feedback does.
 *
 * Copy drafts: STRINGS-FOR-BARB.md §Assignment-Player.
 */

import React from 'react';
import { assertNoLeak } from '@/lib/copy/leakGuard';
import type { AssignmentResultBundle } from '@/lib/assignments/assignmentResultBundle';
import { MathText } from '@/components/core/MathText';

export interface AssignmentResultScreenProps {
  result: AssignmentResultBundle;
  onBack?: () => void;
}

export function AssignmentResultScreen({ result, onBack }: AssignmentResultScreenProps) {
  const { gradePct, masteryLabel, message, overallFeedback, taskFeedback } = result;

  // assertNoLeak on every NON-grade rendered string (belt-and-suspenders; the
  // bundle already double-guards, but the render boundary is the last defense).
  // gradePct is deliberately NOT asserted — it is the allow-listed carve-out.
  if (message.message) assertNoLeak(message.message, 'AssignmentResultScreen/message');
  if (message.teliMsg) assertNoLeak(message.teliMsg, 'AssignmentResultScreen/teliMsg');
  if (masteryLabel) assertNoLeak(masteryLabel, 'AssignmentResultScreen/masteryLabel');
  if (overallFeedback) assertNoLeak(overallFeedback, 'AssignmentResultScreen/overallFeedback');
  for (const t of taskFeedback) {
    if (t.feedback) assertNoLeak(t.feedback, `AssignmentResultScreen/taskFeedback/${t.step}`);
  }

  return (
    <div className="flex flex-col gap-6 py-8 px-4 max-w-xl mx-auto">
      {/* Heading + grade */}
      <div className="text-center flex flex-col gap-3">
        <h1 className="font-display text-2xl text-fg font-bold">You turned it in! ✨</h1>
        {/* The grade — the ONE allow-listed number the student sees. */}
        <div className="flex justify-center">
          <div
            data-testid="grade-display"
            className="inline-flex flex-col items-center rounded-lg border-2 border-brand bg-brand-surface px-8 py-4 shadow-sticker"
          >
            <span className="font-display text-4xl text-fg font-bold leading-none">{gradePct}%</span>
            <span className="text-brand-fg text-xs font-semibold uppercase tracking-widest mt-1">Your grade</span>
          </div>
        </div>
        {/* Coaching headline */}
        {message.message && (
          <p className="text-fg text-base leading-relaxed">{message.message}</p>
        )}
      </div>

      {/* Teli coaching message */}
      {message.teliMsg && (
        <div className="rounded-lg border-2 border-brand bg-brand-surface shadow-sticker px-5 py-4">
          <p className="text-brand-fg text-sm leading-relaxed italic">&ldquo;{message.teliMsg}&rdquo;</p>
          <p className="text-brand-fg text-xs mt-1 font-semibold">— Teli</p>
        </div>
      )}

      {/* Mastery label — neutral pill, no color coding, no raw enum. */}
      {masteryLabel && (
        <div className="flex justify-center">
          <span className="mastery-label inline-flex items-center rounded px-2.5 py-0.5 text-sm font-medium bg-surface text-fg border border-fg-muted">
            {masteryLabel}
          </span>
        </div>
      )}

      {/* Overall feedback */}
      {overallFeedback && (
        <div className="rounded-lg border-2 border-surface bg-surface shadow-sticker px-5 py-4 flex flex-col gap-2">
          <p className="text-fg font-semibold text-sm">What your teacher noticed</p>
          <p className="text-fg text-sm leading-relaxed">
            <MathText>{overallFeedback}</MathText>
          </p>
        </div>
      )}

      {/* Per-task feedback — PROSE ONLY. The numeric per-task grade is never shown. */}
      {taskFeedback.length > 0 && (
        <ul className="flex flex-col gap-3">
          {taskFeedback.map((t) => (
            <li
              key={t.step}
              className="rounded-lg border-2 border-surface bg-surface shadow-sticker px-5 py-4 flex flex-col gap-1"
            >
              <p className="text-fg-muted text-xs font-semibold uppercase tracking-wide">Question {t.step}</p>
              <p className="text-fg text-sm leading-relaxed">
                <MathText>{t.feedback}</MathText>
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* CTAs */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onBack ?? (() => { window.location.href = '/student/assignments'; })}
          className="rounded-lg bg-brand text-fg-on-brand font-semibold px-6 py-3 shadow-sticker hover:opacity-90 text-center"
        >
          Back to assignments
        </button>
      </div>
    </div>
  );
}

export default AssignmentResultScreen;
