// ============================================================
// src/lib/quiz/__tests__/isQuizAvailableForStudent.test.ts
//
// Pure-helper tests for the in-class-only availability policy
// ported from V1 (C:/users/inteliflow/core/lib/student/quizAvailability.ts).
//
// Policy (verbatim from V1):
//   1. Already-completed → never available.
//   2. No publishedAt → never available (defensive guard).
//   3. No enrolledAt → never available (student not actively enrolled).
//   4. publishedAt < enrolledAt → never available (pre-enrollment backlog).
//   5. hasAnyAttempt (started or teacher-granted) → available, regardless
//      of how long ago the quiz was published.
//   6. No grant marker → available only within IN_CLASS_WINDOW_MINUTES of
//      publishedAt (inclusive on the upper bound).
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  isQuizAvailableForStudent,
  IN_CLASS_WINDOW_MINUTES,
} from '../isQuizAvailableForStudent';

const NOW = new Date('2026-05-02T15:00:00Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const minutesFromNow = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

const baseEnrolledAt = '2026-04-01T00:00:00Z';

const fresh = {
  enrolledAt: baseEnrolledAt,
  hasAnyAttempt: false,
  hasCompletedAttempt: false,
  now: NOW,
};

describe('isQuizAvailableForStudent — in-class window', () => {
  it('visible during the window (1 min after publish)', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(1),
    })).toBe(true);
  });

  it('visible exactly at the window boundary (5 min after publish)', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(IN_CLASS_WINDOW_MINUTES),
    })).toBe(true);
  });

  it('invisible past the window (10 min after publish, no grant)', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(10),
    })).toBe(false);
  });

  it('invisible 24h past window with no grant', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(60 * 24),
    })).toBe(false);
  });

  it('honours an injected windowMinutes override', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(8),
      windowMinutes: 10,
    })).toBe(true);
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(8),
      windowMinutes: 5,
    })).toBe(false);
  });
});

describe('isQuizAvailableForStudent — grant marker overrides window', () => {
  it('visible past window when any attempt exists (teacher-granted or self-started)', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(60),
      hasAnyAttempt: true,
    })).toBe(true);
  });

  it('grant marker still respects "already completed" — never re-offers', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(60),
      hasAnyAttempt: true,
      hasCompletedAttempt: true,
    })).toBe(false);
  });

  it('teacher grant works even days after publish', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(60 * 24 * 3),
      hasAnyAttempt: true,
    })).toBe(true);
  });
});

describe('isQuizAvailableForStudent — exclusions', () => {
  it('completed → invisible regardless of window', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(1),
      hasCompletedAttempt: true,
    })).toBe(false);
  });

  it('pre-enrollment quiz → invisible even within the publish window', () => {
    // Quiz published 31 min ago, student enrolled 30 min ago →
    // publishedAt < enrolledAt → not their quiz.
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(31),
      enrolledAt: minutesAgo(30),
    })).toBe(false);
  });

  it('null publishedAt → invisible (defensive)', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: null,
    })).toBe(false);
  });

  it('null enrolledAt → invisible (student not actively enrolled)', () => {
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesAgo(1),
      enrolledAt: null,
    })).toBe(false);
  });
});

describe('isQuizAvailableForStudent — timing edge cases', () => {
  it('publishedAt slightly in the future (clock skew) → still within window', () => {
    // ageMs = negative → ageMs <= windowMs → true
    expect(isQuizAvailableForStudent({
      ...fresh,
      publishedAt: minutesFromNow(1),
    })).toBe(true);
  });
});
