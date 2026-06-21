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
  rosterRisk: { risk_level: string; risk_factors: string[] };
}

// Conservative first-pass thresholds — speak rarely. Tunable; Barb/Marvin may adjust.
const MIN_OBSERVATIONS = 2;   // floor before any behavioral "watch" — a pattern, not one quiz
const FRUSTRATION_HOT = 0.6;
const ATTENTION_LOW = 0.4;
const ENGAGEMENT_LOW = 0.4;
const PREDICTIVE_HOT = 0.6;

export function coachObservation(input: CoachObservationInput): CoachObservation {
  const { computed, observationCount, firstName, rosterRisk } = input;
  const subject = (firstName ?? '').trim() || 'This student';

  // 1. Not enough yet → quiet (cold-start).
  if (
    computed == null ||
    observationCount < MIN_OBSERVATIONS ||
    computed.errorPatternType === 'insufficient_data'
  ) {
    return {
      state: 'quiet',
      eyebrow: 'Still settling in',
      line: `Still getting to know how ${subject} works — a few more quizzes will tell.`,
      suggestion: null,
      tone: 'ok',
    };
  }

  // 2. A sustained behavioral pattern worth mentioning (first match wins).
  const c = computed;
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

  // 3. Else, the existing score-based concern (plain words — never reuse riskFactorPhrase, which says "score").
  if (rosterRisk.risk_level !== 'low') {
    return watch('risk', `${subject}'s recent quizzes have dipped.`, 'Worth a closer look at what changed.');
  }

  // 4. Else → calm.
  return {
    state: 'calm',
    eyebrow: 'Settling in',
    line: `${subject}'s working at a steady, focused pace right now.`,
    suggestion: null,
    tone: 'ok',
  };
}

function watch(tone: 'risk' | 'warn', line: string, suggestion: string): CoachObservation {
  return { state: 'watch', eyebrow: 'Worth a look', line, suggestion, tone };
}
