'use client';

/**
 * StateScreens — the non-result terminal/transient screens for the player:
 *   • SubmittingScreen   — full-bleed overlay while the grade is in flight
 *   • PendingScreen      — server delayed grading (never-half-grade path)
 *   • ErrorScreen        — a network/server failure; lets the student retry
 *
 * All copy is static + audience-safe (no numbers, no banned words). Token-only
 * styling (no hex / no arbitrary [var(--..)]).
 */

import React from 'react';

export function SubmittingScreen() {
  return (
    <div className="fixed inset-0 bg-bg/90 flex flex-col items-center justify-center gap-4 z-50">
      <span aria-hidden className="text-5xl animate-pulse">✍️</span>
      <p className="font-display text-xl text-fg font-bold">Turning it in…</p>
      <p className="text-fg-muted text-sm">Hang tight while we look over your work.</p>
    </div>
  );
}

export function PendingScreen({ message, onBack }: { message?: string; onBack?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-12 px-6 text-center">
      <span aria-hidden className="text-5xl">⏳</span>
      <h1 className="font-display text-2xl text-fg font-bold">Your work is being graded</h1>
      <div className="rounded-lg border-2 border-warn bg-warn-surface px-5 py-4 max-w-sm text-left">
        <p className="text-fg text-sm leading-relaxed">
          {message ?? 'Your answers have been saved. Grading is on its way — check back shortly.'}
        </p>
      </div>
      <button
        type="button"
        onClick={onBack ?? (() => { window.location.href = '/student/assignments'; })}
        className="rounded-lg bg-brand text-fg-on-brand font-semibold px-6 py-3 shadow-sticker hover:opacity-90"
      >
        Back to assignments
      </button>
    </div>
  );
}

export function ErrorScreen({ onRetry, onBack }: { onRetry?: () => void; onBack?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-12 px-6 text-center">
      <span aria-hidden className="text-5xl">⚠️</span>
      <h1 className="font-display text-2xl text-fg font-bold">Something went wrong</h1>
      <p className="text-fg-muted text-sm leading-relaxed max-w-sm">
        Your answers are saved. Give it another try, or come back in a moment.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-brand text-fg-on-brand font-semibold px-6 py-3 shadow-sticker hover:opacity-90"
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={onBack ?? (() => { window.location.href = '/student/assignments'; })}
          className="rounded-lg border-2 border-surface bg-surface text-fg font-semibold px-6 py-3 hover:border-brand"
        >
          Back to assignments
        </button>
      </div>
    </div>
  );
}
