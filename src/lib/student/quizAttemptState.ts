// ============================================================
// lib/student/quizAttemptState.ts
//
// Pure classifier for the wall-clock + closure-recovery quiz
// flow. Single source of truth for "what state is this attempt
// in right now". Used by:
//   - /api/attempts/start to decide whether to forfeit on touch
//   - /api/attempts/student-quiz to decide what state to return
//   - the quiz taking-state page to render banner / forfeit
//     screen / normal active flow
//
// The classifier is intentionally pure — Date is injected, no
// DB, no React. Testable as a table.
//
// State semantics:
//   - completed_normal: is_complete=true and submitted_at set
//     by a real submit. The quiz is done; show review state.
//   - closure_forfeit: is_complete=true and forfeit_reason=
//     'closure'. Set by lazy forfeit when an endpoint touches
//     an attempt whose last_active_at is older than 5 min.
//   - time_up_forfeit: is_complete=true and forfeit_reason=
//     'time_up'. Set when started_at + 10 min has passed.
//   - fresh: started_at is NULL. Created by teacher grant, not
//     yet started. The wall-clock hasn't begun.
//   - active: started_at set, in window, recent heartbeat
//     (≤30 sec gap). Normal taking state.
//   - resuming_after_gap: started_at set, in window, gap is
//     30 sec to 5 min. Show recovery banner; resume.
//
// "in window" = now < started_at + 10 minutes (QUIZ_DURATION_MINUTES).
// ============================================================

export const QUIZ_DURATION_MINUTES = 10;
export const CLOSURE_FORFEIT_MINUTES = 5;
export const RESUME_BANNER_THRESHOLD_SECONDS = 30;

export type AttemptState =
  | 'completed_normal'
  | 'closure_forfeit'
  | 'time_up_forfeit'
  | 'fresh'
  | 'active'
  | 'resuming_after_gap';

export interface AttemptStateInput {
  isComplete: boolean;
  /** When set, the attempt was finalized as a forfeit, not a
   *  normal submit. Distinguishes review-state from forfeit-
   *  screen. New column added in migration TBD; for now passed
   *  via finalizeAttempt and persisted on the attempt row. */
  forfeitReason: 'closure' | 'time_up' | null;
  startedAt: string | null;
  lastActiveAt: string | null;
  now: Date;
  /** Injected for tests; defaults to QUIZ_DURATION_MINUTES. */
  quizDurationMinutes?: number;
  closureForfeitMinutes?: number;
}

export function classifyAttemptState(input: AttemptStateInput): AttemptState {
  const {
    isComplete,
    forfeitReason,
    startedAt,
    lastActiveAt,
    now,
    quizDurationMinutes = QUIZ_DURATION_MINUTES,
    closureForfeitMinutes = CLOSURE_FORFEIT_MINUTES,
  } = input;

  if (isComplete) {
    if (forfeitReason === 'closure') return 'closure_forfeit';
    if (forfeitReason === 'time_up') return 'time_up_forfeit';
    return 'completed_normal';
  }

  // Not yet started — teacher grant row, no wall-clock yet.
  if (!startedAt) return 'fresh';

  const startedMs = new Date(startedAt).getTime();
  const elapsedSec = (now.getTime() - startedMs) / 1000;
  const durationSec = quizDurationMinutes * 60;

  // Wall-clock expired. The endpoint that classified this is
  // expected to call finalizeAttempt with reason='time_up' on
  // the next touch. The state itself is the marker that the
  // forfeit hasn't been committed yet — UI should NOT render
  // taking screen in this state.
  if (elapsedSec >= durationSec) return 'time_up_forfeit';

  // Closure detection. A null lastActiveAt mid-attempt is
  // unusual (every heartbeat sets it), so treat it as a closure
  // gap measured from started_at — a student who started but
  // never managed to send a heartbeat should not get unbounded
  // grace.
  const lastSeenMs = lastActiveAt ? new Date(lastActiveAt).getTime() : startedMs;
  const gapSec = (now.getTime() - lastSeenMs) / 1000;
  const closureSec = closureForfeitMinutes * 60;

  if (gapSec >= closureSec) return 'closure_forfeit';
  if (gapSec >= RESUME_BANNER_THRESHOLD_SECONDS) return 'resuming_after_gap';
  return 'active';
}

/**
 * Time remaining on the wall-clock quiz timer in whole seconds.
 * Returns 0 when expired or unstarted. The taking-state page
 * uses this on every render — the value drives the timer ring,
 * the auto-submit trigger, and the forfeit threshold.
 */
export function quizTimeRemainingSeconds(
  startedAt: string | null,
  now: Date,
  quizDurationMinutes: number = QUIZ_DURATION_MINUTES,
): number {
  if (!startedAt) return quizDurationMinutes * 60;
  const elapsedSec = (now.getTime() - new Date(startedAt).getTime()) / 1000;
  const durationSec = quizDurationMinutes * 60;
  return Math.max(0, Math.floor(durationSec - elapsedSec));
}

/**
 * Closure recovery seconds remaining — the number of seconds
 * a student has to come back before forfeit. Returns 0 when
 * already past the closure threshold or when no liveness data
 * exists. Drives the recovery banner countdown.
 */
export function closureSecondsRemaining(
  lastActiveAt: string | null,
  now: Date,
  closureForfeitMinutes: number = CLOSURE_FORFEIT_MINUTES,
): number {
  if (!lastActiveAt) return 0;
  const gapSec = (now.getTime() - new Date(lastActiveAt).getTime()) / 1000;
  const closureSec = closureForfeitMinutes * 60;
  return Math.max(0, Math.floor(closureSec - gapSec));
}
