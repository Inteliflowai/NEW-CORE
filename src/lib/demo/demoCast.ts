// src/lib/demo/demoCast.ts
// Pure, typed demo cast for CORE v2. NO Next/Supabase imports.
// Each profile is engineered so the REAL signal functions (diagnose,
// computeHwQuizDivergence, computeRosterRiskIndex, currentMasteryBand) emit a
// distinct case — proven in demoCast.test.ts. See grounding p4b-04.
import type { MasteryBand } from '@/types/core';

export type EffortLabel =
  | 'effortful_success' | 'struggling_trying'
  | 'independent_success' | 'independent_struggle';

/** One quiz attempt (newest-first in the array). daysAgo sets submitted_at/created_at = now − daysAgo. */
export interface DemoQuiz { score_pct: number; mastery_band: MasteryBand; daysAgo: number }

/** One homework attempt. status 'graded' → score_pct + graded; 'submitted' → submitted, ungraded.
 *  'missing'/'not-due' cells are produced by ABSENCE of a row (see buildSeedRows), not here. */
export interface DemoHw {
  score_pct: number | null;
  status: 'graded' | 'submitted';
  daysAgo: number;
  is_redo?: boolean;
  allow_redo?: boolean;
  flagged_by?: 'auto' | 'teacher';
}

export interface DemoStudent {
  key: string;            // stable slug for email + idempotency
  full_name: string;
  effort_label: EffortLabel;
  quizzes: DemoQuiz[];    // [] = never assessed (Nadia)
  homework: DemoHw[];
  reteachNeeded?: boolean;
  /** human-readable expected outcomes — asserted in the test, not written to DB. */
  expect: {
    band: MasteryBand | null;
    volatile: boolean;
    diagnose: 'verbal_check' | 'reteach' | 'profile' | 'monitor' | null;
    risk: 'low' | 'medium' | 'high' | 'critical';
  };
}

export const DEMO_SCHOOL_NAME = 'CORE Demo School';

export const DEMO_TEACHER  = { key: 'teacher',  full_name: 'Dana Whitfield', role: 'teacher' as const };
export const DEMO_TEACHER2 = { key: 'teacher2', full_name: 'Marcus Bell',    role: 'teacher' as const };
export const DEMO_PARENT   = { key: 'parent',   full_name: 'Rosa Rivera',    role: 'parent'  as const };
export const DEMO_ADMIN    = { key: 'admin',     full_name: 'Priya Anand',   role: 'school_admin' as const };

// Engineered cast. Targets chosen so the REAL signal fns emit each case (see test).
export const DEMO_STUDENTS: DemoStudent[] = [
  { key: 'alex',   full_name: 'Alex Rivera',   effort_label: 'independent_success',
    quizzes: [{score_pct:90,mastery_band:'advanced',daysAgo:2},{score_pct:92,mastery_band:'advanced',daysAgo:9},{score_pct:88,mastery_band:'advanced',daysAgo:16}],
    homework: [{score_pct:92,status:'graded',daysAgo:2},{score_pct:90,status:'graded',daysAgo:9},{score_pct:94,status:'graded',daysAgo:16}],
    expect: { band:'advanced', volatile:false, diagnose:null, risk:'low' } },          // hw+quiz>=85 -> 0; +20 completion = 20 low

  { key: 'sofia',  full_name: 'Sofia Chen',    effort_label: 'effortful_success',
    quizzes: [{score_pct:59,mastery_band:'grade_level',daysAgo:2},{score_pct:60,mastery_band:'grade_level',daysAgo:9},{score_pct:58,mastery_band:'grade_level',daysAgo:16}],
    homework: [{score_pct:86,status:'graded',daysAgo:2},{score_pct:88,status:'graded',daysAgo:9},{score_pct:84,status:'graded',daysAgo:16}],
    expect: { band:'grade_level', volatile:false, diagnose:'profile', risk:'medium' } }, // gap +27 div 54, hw>=50 & quiz>=50 -> profile; risk ~45 medium

  { key: 'marcus', full_name: 'Marcus Johnson', effort_label: 'struggling_trying', reteachNeeded: true,
    quizzes: [{score_pct:40,mastery_band:'reteach',daysAgo:3},{score_pct:70,mastery_band:'grade_level',daysAgo:10},{score_pct:45,mastery_band:'reteach',daysAgo:17}],
    homework: [{score_pct:50,status:'graded',daysAgo:3},{score_pct:52,status:'graded',daysAgo:10},{score_pct:48,status:'graded',daysAgo:17}],
    expect: { band:'reteach', volatile:true, diagnose:null, risk:'high' } },            // gap ~-2 aligned -> null; last-3 bands {reteach,grade_level,reteach}; risk ~70

  { key: 'emma',   full_name: 'Emma Patel',    effort_label: 'independent_struggle',
    quizzes: [{score_pct:66,mastery_band:'grade_level',daysAgo:2},{score_pct:45,mastery_band:'reteach',daysAgo:9},{score_pct:82,mastery_band:'advanced',daysAgo:16}],
    homework: [{score_pct:40,status:'graded',daysAgo:2},{score_pct:42,status:'graded',daysAgo:9},{score_pct:38,status:'graded',daysAgo:16}],
    expect: { band:'grade_level', volatile:true, diagnose:'verbal_check', risk:'high' } }, // hw 40 / quiz ~64 -> div 49, hw<50 & quiz>=60

  { key: 'jordan', full_name: 'Jordan Kim',    effort_label: 'effortful_success',
    quizzes: [{score_pct:72,mastery_band:'grade_level',daysAgo:4},{score_pct:70,mastery_band:'grade_level',daysAgo:11},{score_pct:74,mastery_band:'grade_level',daysAgo:18}],
    // reteach cycle: original (allow_redo, flagged teacher, 55, OLDER) -> later redo (80, NEWER). improvement +25.
    homework: [{score_pct:80,status:'graded',daysAgo:4,is_redo:true},
               {score_pct:55,status:'graded',daysAgo:12,allow_redo:true,flagged_by:'teacher'},
               {score_pct:71,status:'graded',daysAgo:19},{score_pct:70,status:'graded',daysAgo:26}],
    expect: { band:'grade_level', volatile:false, diagnose:null, risk:'high' } },        // RE-LABELED high (computes ~51): hw_avg 69 + redoRate .5. medium covered by Sofia/Nadia.

  { key: 'lily',   full_name: 'Lily Torres',   effort_label: 'effortful_success',
    quizzes: [{score_pct:76,mastery_band:'grade_level',daysAgo:3},{score_pct:74,mastery_band:'grade_level',daysAgo:10},{score_pct:78,mastery_band:'grade_level',daysAgo:17}],
    homework: [{score_pct:64,status:'graded',daysAgo:3},{score_pct:62,status:'graded',daysAgo:10},{score_pct:66,status:'graded',daysAgo:17}],
    expect: { band:'grade_level', volatile:false, diagnose:'monitor', risk:'high' } },    // gap -12 div 24 -> monitor

  { key: 'darius', full_name: 'Darius Moore',  effort_label: 'independent_struggle',
    // R1 FIX: all submissions >21d stale (recency +5) + 2 is_redo (redoRate .67 -> +~4.5) on top of hw 58/quiz ~37 (25+25) + completion 20 = ~79 CRITICAL.
    // No allow_redo here, so Darius forms NO reteach cycle (only Jordan does).
    quizzes: [{score_pct:36,mastery_band:'reteach',daysAgo:22},{score_pct:40,mastery_band:'reteach',daysAgo:26},{score_pct:34,mastery_band:'reteach',daysAgo:30}],
    homework: [{score_pct:58,status:'graded',daysAgo:22,is_redo:true},{score_pct:60,status:'graded',daysAgo:26},{score_pct:56,status:'graded',daysAgo:30,is_redo:true}],
    expect: { band:'reteach', volatile:false, diagnose:'reteach', risk:'critical' } },    // hw 58 / quiz ~37 -> div 43, quiz<50 -> reteach

  { key: 'nadia',  full_name: 'Nadia Okafor',  effort_label: 'independent_success',
    quizzes: [],                                                                          // never assessed -> null band (cold-start)
    homework: [{score_pct:88,status:'graded',daysAgo:5},{score_pct:86,status:'graded',daysAgo:12}],
    expect: { band:null, volatile:false, diagnose:null, risk:'medium' } },                // no quiz -> quizPenalty 7.5 + completion 20 ~= 27.5 medium
];
