// ============================================================
// src/lib/quiz/isQuizAvailableForStudent.ts
//
// Pure helper that decides whether a published quiz is currently
// "available" for a given student to start. Ported verbatim from
// V1: C:/users/inteliflow/core/lib/student/quizAvailability.ts
//
// Eligibility rules (exact V1 logic, in evaluation order):
//
//   1. Already-completed → never available (hasCompletedAttempt).
//   2. No publishedAt → never available (defensive: status='published'
//      without a timestamp shouldn't happen but is guarded).
//   3. No enrolledAt → never available (student has no active enrollment
//      in the quiz's class).
//   4. publishedAt < enrolledAt → never available (pre-enrollment
//      backlog: student wasn't in the class when the quiz was published;
//      comparison is lexicographic ISO-8601 string comparison, equivalent
//      to chronological order).
//   5. hasAnyAttempt (student started in-class, OR teacher-granted an
//      empty attempt row) → available regardless of publish age.
//   6. No grant marker → available only if the quiz was published within
//      IN_CLASS_WINDOW_MINUTES ago (inclusive upper bound: ageMs <= windowMs).
//      Clock-skew: publishedAt slightly in the future produces negative
//      ageMs, which is <= windowMs, so the quiz stays visible.
//
// Wall-clock "now" is injected so this is unit-testable without faking
// Date. Both student endpoints call it with `new Date()`.
// ============================================================

export const IN_CLASS_WINDOW_MINUTES = 5;

export interface QuizAvailabilityInput {
  publishedAt: string | null;
  enrolledAt: string | null;
  /** Any quiz_attempts row exists for this (student, quiz) pair —
   *  whether started by the student in class or pre-created by a
   *  teacher grant. Either way it is the grant marker. */
  hasAnyAttempt: boolean;
  /** Subset of hasAnyAttempt where submitted_at IS NOT NULL or is_complete = true. */
  hasCompletedAttempt: boolean;
  now: Date;
  /** Defaults to IN_CLASS_WINDOW_MINUTES; injectable for tests. */
  windowMinutes?: number;
}

export function isQuizAvailableForStudent(input: QuizAvailabilityInput): boolean {
  const {
    publishedAt,
    enrolledAt,
    hasAnyAttempt,
    hasCompletedAttempt,
    now,
    windowMinutes = IN_CLASS_WINDOW_MINUTES,
  } = input;

  // Rule 1: Already done — never re-offer.
  if (hasCompletedAttempt) return false;

  // Rule 2: Defensive — quiz with status='published' but no published_at
  // shouldn't exist, but guard anyway.
  if (!publishedAt) return false;

  // Rule 3: No active enrollment record for this class.
  if (!enrolledAt) return false;

  // Rule 4: Pre-enrollment backlog — student wasn't in the class when the
  // quiz was published. ISO-8601 lexicographic comparison is chronological.
  if (publishedAt < enrolledAt) return false;

  // Rule 5: Grant marker — student started in class (real attempt row) or
  // teacher granted access (empty attempt row). Available regardless of age.
  if (hasAnyAttempt) return true;

  // Rule 6: No grant marker → only available during the in-class window.
  // Inclusive upper bound: exactly at windowMs is still available.
  const ageMs = now.getTime() - new Date(publishedAt).getTime();
  const windowMs = windowMinutes * 60_000;
  return ageMs <= windowMs;
}
