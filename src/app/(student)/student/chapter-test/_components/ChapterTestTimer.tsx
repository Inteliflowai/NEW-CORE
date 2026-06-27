'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface ChapterTestTimerProps {
  /** ISO timestamp when the attempt was started (server-stamped). */
  startedAt: string;
  /** Total duration in minutes (44 for a chapter test). */
  totalMinutes: number;
  /** Called exactly once when elapsed time >= totalMinutes * 60 seconds. */
  onTimeUp: () => void;
}

/** Format an integer number of seconds as MM:SS (zero-padded minutes). */
function fmtSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Wall-clock remaining time.
 * Recomputes from the real elapsed time so it stays honest across page reloads.
 * Never a simple client-side countdown that forgets elapsed time.
 */
function computeRemaining(startedAt: string, totalSeconds: number): number {
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return Math.max(0, totalSeconds - elapsed);
}

function prefersReducedMotionNow(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Countdown timer for the chapter test player.
 *
 * - Recomputes remaining time from `Date.now() - startedAt` every second
 *   so it stays accurate across page reloads.
 * - Fires `onTimeUp()` exactly once when elapsed >= totalMinutes * 60 s.
 * - When `prefers-reduced-motion`: skips the interval and shows `--:--`.
 * - When < 5 minutes remain: applies risk-tone border + text (WCAG: non-color cue + color together).
 */
export function ChapterTestTimer({ startedAt, totalMinutes, onTimeUp }: ChapterTestTimerProps) {
  const totalSeconds = totalMinutes * 60;
  const [remaining, setRemaining] = useState<number>(() =>
    computeRemaining(startedAt, totalSeconds),
  );
  const firedRef = useRef(false);
  // Keep a stable ref so the interval closure doesn't capture a stale callback.
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;

  useEffect(() => {
    if (prefersReducedMotionNow()) {
      // Accessibility: skip interval entirely — the static display will show --:--
      return;
    }

    const id = setInterval(() => {
      const rem = computeRemaining(startedAt, totalSeconds);
      setRemaining(rem);

      if (rem <= 0 && !firedRef.current) {
        firedRef.current = true;
        onTimeUpRef.current();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [startedAt, totalSeconds]);

  const reducedMotion = prefersReducedMotionNow();
  const isUrgent = remaining < 300 && !reducedMotion; // < 5 minutes
  const display = reducedMotion ? '--:--' : fmtSeconds(remaining);
  const ariaLabel = reducedMotion
    ? 'Timer paused (reduced motion)'
    : `${fmtSeconds(remaining)} remaining`;

  return (
    <div
      role="timer"
      aria-label={ariaLabel}
      aria-live="off"
      className={[
        'inline-flex items-center px-3 py-1 rounded font-display font-bold tabular-nums text-lg border-2',
        isUrgent
          ? 'border-risk-fg text-risk-fg bg-risk-surface'
          : 'border-surface text-fg bg-surface',
      ].join(' ')}
    >
      {display}
    </div>
  );
}
