import { describe, it, expect } from 'vitest';
import {
  classifyAttemptState, quizTimeRemainingSeconds, closureSecondsRemaining,
  QUIZ_DURATION_MINUTES, CLOSURE_FORFEIT_MINUTES, RESUME_BANNER_THRESHOLD_SECONDS,
} from '../quizAttemptState';

const base = { isComplete: false, forfeitReason: null as null, startedAt: '2026-06-20T00:00:00.000Z', lastActiveAt: '2026-06-20T00:00:00.000Z' };
const at = (s: string) => new Date(s);

describe('classifyAttemptState', () => {
  it('completed → completed_normal / closure_forfeit / time_up_forfeit by forfeitReason', () => {
    expect(classifyAttemptState({ ...base, isComplete: true, now: at('2026-06-20T00:01:00Z') })).toBe('completed_normal');
    expect(classifyAttemptState({ ...base, isComplete: true, forfeitReason: 'closure', now: at('2026-06-20T00:01:00Z') })).toBe('closure_forfeit');
    expect(classifyAttemptState({ ...base, isComplete: true, forfeitReason: 'time_up', now: at('2026-06-20T00:01:00Z') })).toBe('time_up_forfeit');
  });
  it('null startedAt → fresh', () => {
    expect(classifyAttemptState({ ...base, startedAt: null, lastActiveAt: null, now: at('2026-06-20T00:00:10Z') })).toBe('fresh');
  });
  it('elapsed >= 10min → time_up_forfeit', () => {
    expect(classifyAttemptState({ ...base, now: at('2026-06-20T00:10:00Z') })).toBe('time_up_forfeit');
  });
  it('idle gap >= 5min → closure_forfeit', () => {
    expect(classifyAttemptState({ ...base, lastActiveAt: '2026-06-20T00:00:00Z', now: at('2026-06-20T00:05:00Z') })).toBe('closure_forfeit');
  });
  it('gap 30s..5min → resuming_after_gap; gap < 30s → active', () => {
    expect(classifyAttemptState({ ...base, lastActiveAt: '2026-06-20T00:00:00Z', now: at('2026-06-20T00:00:45Z') })).toBe('resuming_after_gap');
    expect(classifyAttemptState({ ...base, lastActiveAt: '2026-06-20T00:00:00Z', now: at('2026-06-20T00:00:10Z') })).toBe('active');
  });
});

describe('quizTimeRemainingSeconds', () => {
  it('null start → full duration; counts down; floors at 0', () => {
    expect(quizTimeRemainingSeconds(null, at('2026-06-20T00:00:00Z'))).toBe(600);
    expect(quizTimeRemainingSeconds('2026-06-20T00:00:00Z', at('2026-06-20T00:01:00Z'))).toBe(540);
    expect(quizTimeRemainingSeconds('2026-06-20T00:00:00Z', at('2026-06-20T00:20:00Z'))).toBe(0);
  });
});

describe('constants', () => {
  it('match V1 tunables', () => {
    expect(QUIZ_DURATION_MINUTES).toBe(10);
    expect(CLOSURE_FORFEIT_MINUTES).toBe(5);
    expect(RESUME_BANNER_THRESHOLD_SECONDS).toBe(30);
  });
});
