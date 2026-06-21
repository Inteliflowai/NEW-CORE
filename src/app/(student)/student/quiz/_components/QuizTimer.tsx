'use client';

import React from 'react';

export interface QuizTimerProps {
  timeLeft: number;    // seconds remaining
  totalSeconds: number;
}

/** Format seconds as M:SS */
function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * SVG ring timer. Depletes clockwise from full (rotated -90deg).
 * Token-only colors — no hardcoded hex.
 *
 * Thresholds (from V1 quiz/page.tsx:39–41 + grounding §1.3):
 *   isWarning  = timeLeft <= 180 && timeLeft > 60  → warn tokens
 *   isDanger   = timeLeft <= 60                     → risk tokens
 *   isPulsing  = timeLeft <= 30                     → animate-pulse
 */
export function QuizTimer({ timeLeft, totalSeconds }: QuizTimerProps) {
  const isWarning = timeLeft <= 180 && timeLeft > 60;
  const isDanger  = timeLeft <= 60;
  const isPulsing = timeLeft <= 30;

  // SVG ring geometry
  const R = 36;
  const CIRC = 2 * Math.PI * R;
  const pct = totalSeconds > 0 ? timeLeft / totalSeconds : 0;
  const dash = pct * CIRC;

  const ringColorClass = isDanger
    ? 'text-risk-fg'
    : isWarning
      ? 'text-warn-fg'
      : 'text-brand';

  const bgClass = isDanger
    ? 'bg-risk-surface text-risk-fg'
    : isWarning
      ? 'bg-warn-surface text-warn-fg'
      : 'bg-surface text-fg';

  return (
    <div
      className={`relative inline-flex flex-col items-center justify-center w-24 h-24 rounded-full border-2 border-surface shadow-sticker ${bgClass} ${isPulsing ? 'animate-pulse' : ''}`}
      role="timer"
      aria-label={`${fmt(timeLeft)} remaining`}
      aria-live="off"
    >
      {/* Background ring track */}
      <svg
        viewBox="0 0 88 88"
        className="absolute inset-0 w-full h-full -rotate-90"
        aria-hidden
      >
        <circle
          cx={44} cy={44} r={R}
          fill="none"
          strokeWidth={6}
          className="stroke-surface"
          opacity={0.3}
        />
        <circle
          cx={44} cy={44} r={R}
          fill="none"
          strokeWidth={6}
          className={ringColorClass}
          style={{
            strokeDasharray: `${CIRC}`,
            strokeDashoffset: `${CIRC - dash}`,
            transition: 'stroke-dashoffset 1s linear',
          }}
        />
      </svg>
      {/* Time label */}
      <span className="relative z-10 font-display text-lg font-bold leading-none tabular-nums">
        {fmt(timeLeft)}
      </span>
    </div>
  );
}
