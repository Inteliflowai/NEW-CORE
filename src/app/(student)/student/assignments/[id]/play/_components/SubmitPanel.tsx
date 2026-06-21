'use client';

/**
 * SubmitPanel — the sticky bottom nav for the working (tasks) phase.
 *
 * Back / Next move between tasks; on the last task the Next slot becomes the
 * "Turn in" (submit) button. Submit is GATED on every task carrying text — the
 * student cannot turn in a partially-blank assignment (the server enforces the
 * same completeness gate, so this is the friendly client mirror). Token-only.
 */

import React from 'react';

export interface SubmitPanelProps {
  isFirst: boolean;
  isLast: boolean;
  canAdvance: boolean;   // current task has text — gates Next
  canSubmit: boolean;    // ALL tasks have text — gates Turn in
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
}

export function SubmitPanel({ isFirst, isLast, canAdvance, canSubmit, onPrev, onNext, onSubmit }: SubmitPanelProps) {
  return (
    <div className="sticky bottom-0 bg-bg border-t-2 border-surface px-4 py-3 flex items-center justify-between gap-3">
      {!isFirst ? (
        <button
          type="button"
          onClick={onPrev}
          className="rounded-lg border-2 border-surface bg-surface text-fg font-semibold px-5 py-2 hover:border-brand"
        >
          ← Back
        </button>
      ) : (
        <div />
      )}

      {isLast ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className={[
            'rounded-lg font-bold px-8 py-2 shadow-sticker transition-opacity',
            canSubmit
              ? 'bg-brand text-fg-on-brand hover:opacity-90'
              : 'bg-surface text-fg-muted border-2 border-surface cursor-not-allowed',
          ].join(' ')}
        >
          Turn in
        </button>
      ) : (
        <button
          type="button"
          onClick={onNext}
          disabled={!canAdvance}
          className={[
            'rounded-lg font-bold px-8 py-2 shadow-sticker transition-opacity',
            canAdvance
              ? 'bg-brand text-fg-on-brand hover:opacity-90'
              : 'bg-surface text-fg-muted border-2 border-surface cursor-not-allowed',
          ].join(' ')}
        >
          Next →
        </button>
      )}
    </div>
  );
}

export default SubmitPanel;
