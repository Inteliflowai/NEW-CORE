/**
 * buildTrialRows.ts — Pure builder for the trial-tenant demo dataset. No
 * Supabase/Next imports. Mirrors src/lib/demo/buildSeedRows.ts but for a freshly
 * provisioned trial school: it also emits the scaffold rows (students 2-8, class,
 * enrollments, lesson, quiz, quiz_questions) because the trial tenant starts empty.
 *
 * The first student (DEMO_STUDENTS[0], Alex) and the teacher/parent are pre-created
 * in provisionTrial, so this builder does NOT emit auth-user specs for the first
 * student — but it DOES enroll all 8 (incl. the pre-created one).
 *
 * The writer (seedTrialDemoData.ts) resolves string keys → UUIDs and wraps the
 * Supabase calls. Keys are stable slugs from demoCast.
 *
 * OMITTED (C8 — tables do not exist in V2): student_model, student_gamification,
 * signal_aggregates, alerts. Risk/divergence live on student_model_snapshots.
 */

import type { DemoStudent } from '@/lib/demo/demoCast';
import type { MasteryBand } from '@/types/core';

// ── Identifiers supplied by the writer/provisioner ────────────────────────────

export interface TrialIds {
  schoolId: string;
  schoolIdShort: string; // schoolId.slice(0,8) — used in synthesised student emails
  teacherId: string;
}

// ── Types returned (keyed rows — uuid resolution deferred to writer) ───────────

export interface TrialStudentSpec {
  key: string;
  full_name: string;
  email: string;
  role: 'student';
}

export interface TrialClass {
  school_id: string;
  teacher_id: string;
  name: string;
  subject: string;
  grade_level: string;
}

export interface TrialEnrollment {
  student_key: string; // resolved to uuid by writer
}

export interface TrialLesson {
  title: string;
  status: 'published';
  parsed_content: Record<string, unknown>;
}

export interface TrialQuiz {
  title: string;
  status: 'published';
}

export interface TrialQuizQuestion {
  position: number;
  question_type: 'mcq' | 'open'; // schema CHECK: question_type IN ('mcq','open') — 'numeric' rejected
  question_text: string;
}

export interface TrialQuizAttempt {
  student_key: string;
  score_pct: number;
  mastery_band: MasteryBand;
  submitted_at: string;
  is_complete: boolean;
}

export interface TrialAssignment {
  key: string;
  mastery_band: MasteryBand | null;
  content: Record<string, unknown>; // jsonb NOT NULL (C9)
  due_at: string;
  assigned_at: string;
  status: string;
  reteach_needed?: boolean;
}

export interface TrialHomeworkAttempt {
  student_key: string;
  assignment_key: string;
  status: 'graded' | 'submitted';
  score_pct: number | null;
  submitted_at: string;
  graded_at?: string;
  effort_label?: string;
  allow_redo?: boolean;
  is_redo?: boolean;
  flagged_by?: string;
  responses: { response_text: string };
  // NOTE: class_id deliberately absent (no such column on homework_attempts, C10)
}

export interface TrialSnapshot {
  student_key: string;
  snapshot_date: string; // 'YYYY-MM-DD'
  mastery_band: MasteryBand | null;
  avg_score: number;
  risk_score: number;
  divergence_score: number | null;
  consistency_label: string;
  dominant_effort_pattern: string;
  improvement_4w: number;
  consistency_score: number;
  snapshot_schema_version: 'v2';
}

export interface TrialSkillLearningState {
  student_key: string;
  skill_key: string;  // resolved to skill uuid by writer
  state: string;
  confidence: number;
  observation_count: number;
  evidence: Record<string, unknown>;
  last_reteach_outcome?: string;
}

export interface TrialMisconception {
  student_key: string;
  skill_key: string;
  error_type: string;
  reasoning_pattern: string;
  observed_at: string;
}

export interface TrialRows {
  students: TrialStudentSpec[]; // students 2-8 (first student pre-created)
  class: TrialClass;
  enrollments: TrialEnrollment[]; // all 8 students
  lesson: TrialLesson;
  quiz: TrialQuiz;
  quiz_questions: TrialQuizQuestion[];
  quiz_attempts: TrialQuizAttempt[];
  assignments: TrialAssignment[];
  homework_attempts: TrialHomeworkAttempt[];
  snapshots: TrialSnapshot[];
  skill_learning_state: TrialSkillLearningState[];
  misconceptions: TrialMisconception[];
}

// ── Band-differentiated content (from p4b-05 §11) ─────────────────────────────

const TASKS_BY_BAND: Record<string, { tasks: { type: string; prompt: string }[]; instructions: string }> = {
  reteach: {
    instructions: 'Use the sentence starters and fill in the blanks to show what you know.',
    tasks: [
      { type: 'identify', prompt: 'Identify the key concept from your notes.' },
      { type: 'list',     prompt: 'List three facts you remember about this topic.' },
      { type: 'fill_in',  prompt: 'Fill in: The main cause of ___ is ___.' },
    ],
  },
  grade_level: {
    instructions: 'Explain your thinking in 3–4 sentences for each part.',
    tasks: [
      { type: 'write', prompt: 'Explain the concept in your own words.' },
      { type: 'write', prompt: 'Compare two examples from class.' },
      { type: 'write', prompt: 'Apply this idea to a real-world scenario.' },
    ],
  },
  advanced: {
    instructions: 'Analyze, critique, and design — go beyond the obvious.',
    tasks: [
      { type: 'analyze',  prompt: 'Analyze the strengths and limitations of this approach.' },
      { type: 'critique', prompt: 'Critique the reasoning in the provided argument.' },
      { type: 'create',   prompt: 'Design a solution that addresses the core problem.' },
    ],
  },
};

const RESPONSE_BY_BAND: Record<string, string> = {
  reteach:     'I think the key concept is related to what we studied. The main cause is because things change.',
  grade_level: 'The concept means that systems interact in predictable ways. For example, when we studied energy transfer, we saw how input affects output. In real life, this applies to how machines work efficiently.',
  advanced:    'The approach has merit in controlled conditions but breaks down under edge cases because the underlying assumption — that variables are independent — rarely holds. A better design would account for feedback loops by introducing adaptive thresholds.',
};

// ── Utility ───────────────────────────────────────────────────────────────────

function daysAgo(now: Date, d: number): Date {
  return new Date(now.getTime() - d * 86_400_000);
}
function isoOf(d: Date): string { return d.toISOString(); }
function dateStr(d: Date): string { return d.toISOString().slice(0, 10); }

function bandOf(student: DemoStudent): MasteryBand {
  return student.expect.band === 'advanced' ? 'advanced'
    : student.expect.band === 'reteach' ? 'reteach'
    : 'grade_level';
}

// ── Main function ─────────────────────────────────────────────────────────────

export function buildTrialRows(students: DemoStudent[], ids: TrialIds, now: Date): TrialRows {
  // ── Student auth specs: students 2-8 (first student is pre-created in provisionTrial) ──
  const studentSpecs: TrialStudentSpec[] = students.slice(1).map(s => ({
    key: s.key,
    full_name: s.full_name,
    email: `demo-${s.key}@trial-${ids.schoolIdShort}.core.com`,
    role: 'student',
  }));

  // ── Class ──────────────────────────────────────────────────────────────────
  const trialClass: TrialClass = {
    school_id: ids.schoolId,
    teacher_id: ids.teacherId,
    name: 'Trial Period 1',
    subject: 'General',
    grade_level: '8',
  };

  // ── Enrollments (all 8 — including the pre-created first student) ────────────
  const enrollments: TrialEnrollment[] = students.map(s => ({ student_key: s.key }));

  // ── Lesson + quiz + 5 questions (3 mcq + 2 open) ─────────────────────────────
  const lesson: TrialLesson = {
    title: 'Trial Lesson',
    status: 'published',
    parsed_content: { summary: 'Trial demo lesson content for CORE v2.' },
  };
  const quiz: TrialQuiz = { title: 'Trial Quiz', status: 'published' };
  const quiz_questions: TrialQuizQuestion[] = [
    { position: 1, question_type: 'mcq',  question_text: 'Which best describes the main concept?' },
    { position: 2, question_type: 'open', question_text: 'Explain the concept in your own words.' },
    { position: 3, question_type: 'mcq',  question_text: 'Which example demonstrates the concept?' },
    { position: 4, question_type: 'mcq',  question_text: 'Which statement is correct about the topic?' },
    { position: 5, question_type: 'open', question_text: 'Describe a real-world application.' },
  ];

  // ── Quiz attempts (none for never-assessed students → null-band cold-start) ──
  const quiz_attempts: TrialQuizAttempt[] = [];
  for (const student of students) {
    for (const q of student.quizzes) {
      quiz_attempts.push({
        student_key: student.key,
        score_pct: q.score_pct,
        mastery_band: q.mastery_band,
        submitted_at: isoOf(daysAgo(now, q.daysAgo)),
        is_complete: true,
      });
    }
  }

  // ── Assignments keyed a1–a4 (a4 future → not-due) ────────────────────────────
  const assignmentDefs = [
    { key: 'a1', offsetDays: -10 },
    { key: 'a2', offsetDays: -3  },
    { key: 'a3', offsetDays: -1  },
    { key: 'a4', offsetDays:  5  },
  ];
  const assignments: TrialAssignment[] = assignmentDefs.map(({ key, offsetDays }) => {
    const due = daysAgo(now, -offsetDays);
    // Assigned 2 days before due → four distinct assigned-days for the four defs.
    const assigned = daysAgo(now, -offsetDays + 2);
    return {
      key,
      mastery_band: null,
      content: {
        bandLabel: 'grade_level',
        instructions: TASKS_BY_BAND.grade_level.instructions,
        tasks: TASKS_BY_BAND.grade_level.tasks,
      },
      due_at: isoOf(due),
      assigned_at: isoOf(assigned),
      status: 'published',
    };
  });

  // ── Homework attempts — same cell-state matrix as buildSeedRows ──────────────
  // A1 (now-10d): every student graded
  // A2 (now-3d):  alex/sofia/lily graded; marcus submitted; others graded
  // A3 (now-1d):  darius/emma missing (no row); everyone else graded
  // A4 (now+5d):  no row for anyone (not-due)
  const gradedOnA2 = new Set(['alex', 'sofia', 'lily']);
  const submittedOnA2 = new Set(['marcus']);
  const missingOnA3 = new Set(['darius', 'emma']);

  const homework_attempts: TrialHomeworkAttempt[] = [];
  for (const student of students) {
    const band = bandOf(student);
    const responseText = RESPONSE_BY_BAND[band] ?? RESPONSE_BY_BAND.grade_level;

    // A1
    const hwA1 = student.homework.find(h => h.daysAgo >= 9) ?? student.homework[student.homework.length - 1];
    homework_attempts.push({
      student_key: student.key,
      assignment_key: 'a1',
      status: 'graded',
      score_pct: hwA1?.score_pct ?? 70,
      submitted_at: isoOf(daysAgo(now, 11)),
      graded_at: isoOf(daysAgo(now, 10)),
      effort_label: student.effort_label,
      allow_redo: hwA1?.allow_redo,
      is_redo: hwA1?.is_redo,
      flagged_by: hwA1?.flagged_by,
      responses: { response_text: responseText },
    });

    // A2
    if (submittedOnA2.has(student.key)) {
      homework_attempts.push({
        student_key: student.key,
        assignment_key: 'a2',
        status: 'submitted',
        score_pct: null,
        submitted_at: isoOf(daysAgo(now, 3)),
        effort_label: student.effort_label,
        responses: { response_text: responseText },
      });
    } else if (gradedOnA2.has(student.key)) {
      const hwA2 = student.homework.find(h => h.daysAgo >= 2 && h.daysAgo <= 5) ?? student.homework[0];
      homework_attempts.push({
        student_key: student.key,
        assignment_key: 'a2',
        status: 'graded',
        score_pct: hwA2?.score_pct ?? 70,
        submitted_at: isoOf(daysAgo(now, 4)),
        graded_at: isoOf(daysAgo(now, 3)),
        effort_label: student.effort_label,
        allow_redo: hwA2?.allow_redo,
        is_redo: hwA2?.is_redo,
        flagged_by: hwA2?.flagged_by,
        responses: { response_text: responseText },
      });
    } else {
      homework_attempts.push({
        student_key: student.key,
        assignment_key: 'a2',
        status: 'graded',
        score_pct: student.homework[0]?.score_pct ?? 65,
        submitted_at: isoOf(daysAgo(now, 4)),
        graded_at: isoOf(daysAgo(now, 3)),
        effort_label: student.effort_label,
        responses: { response_text: responseText },
      });
    }

    // A3
    if (!missingOnA3.has(student.key)) {
      homework_attempts.push({
        student_key: student.key,
        assignment_key: 'a3',
        status: 'graded',
        score_pct: student.homework[0]?.score_pct ?? 72,
        submitted_at: isoOf(daysAgo(now, 2)),
        graded_at: isoOf(daysAgo(now, 1)),
        effort_label: student.effort_label,
        responses: { response_text: responseText },
      });
    }
    // A4: no row (not-due)
  }

  // ── Snapshots (≥4 per student, dates now-28/21/14/7d) ───────────────────────
  const snapshotOffsets = [28, 21, 14, 7];
  const snapshots: TrialSnapshot[] = [];
  for (const student of students) {
    const latestBand = student.quizzes.length > 0 ? student.quizzes[0].mastery_band : null;

    const hwScores = student.homework.filter(h => h.score_pct != null).map(h => h.score_pct as number);
    const hwAvg = hwScores.length > 0 ? hwScores.reduce((a, b) => a + b, 0) / hwScores.length : 65;
    const quizScores = student.quizzes.map(q => q.score_pct);
    const quizAvg = quizScores.length > 0 ? quizScores.reduce((a, b) => a + b, 0) / quizScores.length : null;
    const divScore = quizAvg !== null ? Math.abs(hwAvg - quizAvg) : null;

    const riskMap: Record<string, number> = { low: 15, medium: 35, high: 65, critical: 85 };
    const baseRisk = riskMap[student.expect.risk] ?? 35;
    const consistencyLabel = student.expect.volatile ? 'erratic' : 'consistent';
    const baseImprovement = student.expect.band === 'reteach' ? -3 : student.expect.band === 'advanced' ? 5 : 2;

    for (let i = 0; i < snapshotOffsets.length; i++) {
      const offset = snapshotOffsets[i];
      const slope = baseImprovement / 4;
      const snapshotAvg = Math.max(0, Math.min(100, hwAvg + slope * (i - 3)));
      snapshots.push({
        student_key: student.key,
        snapshot_date: dateStr(daysAgo(now, offset)),
        mastery_band: latestBand,
        avg_score: Math.round(snapshotAvg * 10) / 10,
        risk_score: baseRisk,
        divergence_score: divScore !== null ? Math.round(divScore * 10) / 10 : null,
        consistency_label: consistencyLabel,
        dominant_effort_pattern: student.effort_label,
        improvement_4w: baseImprovement,
        consistency_score: student.expect.volatile ? 40 : 80,
        snapshot_schema_version: 'v2',
      });
    }
  }

  // ── Skill learning state (6-value enum across students) ──────────────────────
  // Mirrors buildSeedRows exactly: same state map, same confidence logic,
  // same last_reteach_outcome pattern, keyed on 'demo-skill-1'.
  const SLS_STATES = [
    'needs_different_instruction',
    'needs_more_time',
    'on_track',
    'ready_to_extend',
    'insufficient_data',
    'not_attempted',
  ] as const;

  type SlsState = typeof SLS_STATES[number];

  const stateMap: Record<string, SlsState> = {
    alex:   'ready_to_extend',
    sofia:  'on_track',
    marcus: 'needs_different_instruction',
    emma:   'needs_more_time',
    jordan: 'on_track',
    lily:   'on_track',
    darius: 'needs_different_instruction',
    nadia:  'insufficient_data',
  };

  const skill_learning_state: TrialSkillLearningState[] = students.map(student => {
    const state = stateMap[student.key] ?? 'not_attempted';
    const hasReteachOutcome = student.key === 'jordan' || student.key === 'marcus';
    return {
      student_key: student.key,
      skill_key: 'demo-skill-1',
      state,
      confidence: state === 'ready_to_extend' ? 85 : state === 'on_track' ? 70 : state === 'insufficient_data' ? 10 : 45,
      observation_count: student.quizzes.length + student.homework.length,
      evidence: {},
      ...(hasReteachOutcome
        ? { last_reteach_outcome: student.key === 'jordan' ? 'improved' : 'needs_follow_up' }
        : {}),
    };
  });

  // ── Misconceptions (darius + emma, valid error_type codes) ───────────────────
  const misconceptions: TrialMisconception[] = [
    {
      student_key: 'darius',
      skill_key: 'demo-skill-1',
      error_type: 'reasoning_gap',
      reasoning_pattern: 'partial_reasoning',
      observed_at: isoOf(daysAgo(now, 5)),
    },
    {
      student_key: 'emma',
      skill_key: 'demo-skill-1',
      error_type: 'factual_error',
      reasoning_pattern: 'misconception',
      observed_at: isoOf(daysAgo(now, 3)),
    },
  ];

  return {
    students: studentSpecs,
    class: trialClass,
    enrollments,
    lesson,
    quiz,
    quiz_questions,
    quiz_attempts,
    assignments,
    homework_attempts,
    snapshots,
    skill_learning_state,
    misconceptions,
  };
}
