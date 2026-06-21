'use client';

import React from 'react';

export interface RecoveryBannerProps {
  gapSec: number;
  closureSecondsLeft: number;
  onDismiss: () => void;
}

function fmtGap(gapSec: number): string {
  if (gapSec < 60) return `${gapSec} seconds`;
  return `${Math.round(gapSec / 60)} minute${Math.round(gapSec / 60) === 1 ? '' : 's'}`;
}

function fmtClose(sec: number): string {
  if (sec < 60) return `${sec} seconds`;
  const m = Math.ceil(sec / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/**
 * Recovery banner shown when classifyAttemptState returns 'resuming_after_gap'.
 * Tells the student how long they were away and how long they have before the
 * quiz closes (closureSecondsLeft). Token-only styling (warn surface).
 *
 * Copy proposals in STRINGS-FOR-BARB.md §Quiz-Runner-Phase3 #2.
 */
export function RecoveryBanner({ gapSec, closureSecondsLeft, onDismiss }: RecoveryBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border-2 border-warn bg-warn-surface px-4 py-3 shadow-sticker"
    >
      <span aria-hidden className="mt-0.5 text-warn-fg text-lg">⚠️</span>
      <div className="flex-1 min-w-0">
        <p className="text-fg font-semibold text-sm leading-snug">
          You were away for {fmtGap(gapSec)}
        </p>
        <p className="text-fg text-sm leading-snug mt-0.5">
          The timer kept running.{' '}
          {closureSecondsLeft > 0
            ? `You have ${fmtClose(closureSecondsLeft)} before this quiz closes — keep going!`
            : 'This quiz is about to close — submit what you have.'}
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="shrink-0 text-fg-muted hover:text-fg text-lg leading-none"
      >
        ✕
      </button>
    </div>
  );
}
