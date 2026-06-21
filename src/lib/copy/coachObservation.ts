// src/lib/copy/coachObservation.ts
// TEACHER-ONLY. Turns the per-student EMA behavioral model (smoothed across the
// student's quiz sessions) into ONE plain-language observation, exceptions-first.
//
// The coach speaks ONLY when a real coach would (rushing, drifting, coasting,
// careless), and only once it has seen the student across >= 2 sessions, so the
// voice is honestly "the last few quizzes" — never one bad day. Otherwise it is
// calm/quiet. Numbers and COACH-POSTURE banned words never appear in the output.
//
// Pure: no React, no Next.js, no Supabase, no browser globals. All strings are
// DRAFTS (see STRINGS-FOR-BARB.md) — Barb gates final copy.

import type { ComputedSignals } from '@/lib/signals/behavioralTypes';
import { hasLeak, hasBannedWord } from './leakGuard';

export interface CoachObservation {
  state: 'watch' | 'calm' | 'quiet';
  eyebrow: string;
  line: string;
  suggestion: string | null;
  tone: 'risk' | 'warn' | 'ok';
}

export interface CoachObservationInput {
  computed: ComputedSignals | null;
  observationCount: number;
  firstName: string | null;
  // Only the band matters here — we never render a raw factor (riskFactorPhrase
  // would emit the banned word "score"), so risk_factors is deliberately not consumed.
  rosterRisk: { risk_level: string };
}

// Conservative first-pass thresholds — speak rarely. Tunable; Barb/Marvin may adjust.
const MIN_OBSERVATIONS = 2;   // floor before any behavioral "watch" — a pattern, not one quiz
const FRUSTRATION_HOT = 0.6;
const ATTENTION_LOW = 0.4;
const ENGAGEMENT_LOW = 0.4;
const PREDICTIVE_HOT = 0.6;

export function coachObservation(input: CoachObservationInput): CoachObservation {
  const { computed, observationCount, rosterRisk } = input;
  const subject = sanitizeFirstName(input.firstName);
  const flaggedRisk = rosterRisk.risk_level === 'high' || rosterRisk.risk_level === 'critical';

  // 1. A sustained behavioral pattern (only with >= 2 sessions of usable data) — most specific.
  const usable =
    computed != null &&
    observationCount >= MIN_OBSERVATIONS &&
    computed.errorPatternType !== 'insufficient_data';
  if (usable) {
    const behavioral = behavioralWatch(computed, subject);
    if (behavioral) return behavioral;
  }

  // 2. A FLAGGED score-based concern (high/critical) beats cold-start: priorityCta scrolls a
  //    flagged student to this #at-risk card saying "Review what's going on", so the card must
  //    never read "nothing to see" for the same student. (CTA <-> card coherence.)
  if (flaggedRisk) {
    return watch('risk', `${subject}'s recent quizzes have dipped.`, 'Worth a closer look at what changed.');
  }

  // 3. Not enough yet → quiet (cold-start).
  if (!usable) {
    return {
      state: 'quiet',
      eyebrow: 'Still settling in',
      line: `Still getting to know how ${subject} works — a few more quizzes will tell.`,
      suggestion: null,
      tone: 'ok',
    };
  }

  // 4. A milder (medium) score-based concern.
  if (rosterRisk.risk_level !== 'low') {
    return watch('risk', `${subject}'s recent quizzes have dipped.`, 'Worth a closer look at what changed.');
  }

  // 5. Else → calm.
  return {
    state: 'calm',
    eyebrow: 'Settling in',
    line: `${subject}'s working at a steady, focused pace right now.`,
    suggestion: null,
    tone: 'ok',
  };
}

/** The first matching behavioral pattern as a watch, or null if the model is calm. */
function behavioralWatch(c: ComputedSignals, subject: string): CoachObservation | null {
  if (c.frustrationScore >= FRUSTRATION_HOT) {
    return watch('risk', `${subject}'s been rushing and second-guessing answers the last few quizzes.`, 'A quick check-in might help.');
  }
  if (c.attentionScore <= ATTENTION_LOW) {
    return watch('risk', `${subject} keeps drifting off mid-quiz.`, 'Shorter sessions may land better.');
  }
  if (c.engagementStyle === 'passive' && c.engagementScore <= ENGAGEMENT_LOW) {
    return watch('warn', `${subject}'s been coasting through quizzes lately.`, 'Might be worth re-engaging them.');
  }
  if (c.engagementStyle === 'impulsive' || c.errorPatternType === 'careless') {
    return watch('warn', `${subject}'s racing through and slipping on careless mistakes.`, 'Worth nudging them to slow down.');
  }
  if (c.predictiveRiskScore >= PREDICTIVE_HOT) {
    return watch('warn', `Something's been off in how ${subject}'s been working lately.`, 'Worth a closer look.');
  }
  return null;
}

/** First name for interpolation — falls back to a neutral subject if absent or itself unsafe
 *  (a name carrying a digit or a banned word must never reach the teacher DOM). */
function sanitizeFirstName(firstName: string | null): string {
  const name = (firstName ?? '').trim();
  if (!name || hasLeak(name) || hasBannedWord(name)) return 'This student';
  return name;
}

function watch(tone: 'risk' | 'warn', line: string, suggestion: string): CoachObservation {
  return { state: 'watch', eyebrow: 'Worth a look', line, suggestion, tone };
}
