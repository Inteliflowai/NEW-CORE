// ============================================================
// scripts/eval/types.ts — Eval rig tuple shapes (Stage A)
//
// One discriminated union per scope item per the design doc. Locked
// shapes — corpus files validate against these. Adding a field is a
// breaking change to existing corpus tuples; never remove a field.
//
// The shapes deliberately separate `input` (what the AI call sees),
// `expected_output` (what Barb confirms is correct), and `metadata`
// (provenance). Drift scoring runs candidate output against
// `expected_output`; metadata never feeds into the model or the
// scorer.
// ============================================================

// ── Shared metadata (every tuple) ────────────────────────────────
export interface TupleMetadata {
  /** Which production attempt the tuple was sampled from. */
  sampled_from_attempt_id: string | null;
  /** ISO timestamp of sampling. */
  sampled_at: string;
  /** Has Barb confirmed `expected_output` is correct? Tuples without
   *  this flag set are NOT used as gates — they're informational
   *  only. Stage B Barb-review pass flips this to true. */
  barb_reviewed: boolean;
  /** Free-text notes from the reviewer. Useful for documenting why
   *  this tuple is in the corpus (edge case capture, regression
   *  reproduction, etc.). */
  notes: string;
}

// ── Quiz grading ─────────────────────────────────────────────────
export interface GradingEvalTuple {
  id: string;
  scope: 'grading';
  input: {
    question: string;
    rubric: string;
    student_response: string;
    grade_band: string;
    /** Compact profile context — comprehension level, dominant
     *  style, recent effort signal. Mirrors what the live grading
     *  prompt receives. */
    student_profile_summary: string;
  };
  expected_output: {
    /** 0..1 numeric score. Drift = abs(candidate - expected). */
    score: number;
    /** Reasoning text the model produces alongside the score.
     *  Drift = semantic similarity + voice-rule compliance. */
    cognitive_notes: string;
    /** Tag for the reasoning pattern (e.g. "conceptual_correct",
     *  "procedural_error"). Mostly used for stratification + grouping
     *  in reports. */
    reasoning_pattern: string;
  };
  metadata: TupleMetadata;
}

// ── Quiz generation ──────────────────────────────────────────────
export interface QuizGenerationEvalTuple {
  id: string;
  scope: 'quiz-generation';
  input: {
    lesson_plan_summary: string;
    lesson_objectives: string[];
    grade_band: string;
    subject: string;
    target_question_count: number;
  };
  expected_output: {
    questions: Array<{
      question_text: string;
      question_type: 'mcq' | 'short_answer' | 'open_response';
      correct_answer: string;
      /** Difficulty signature on a 0..1 scale. Drift on this is a
       *  proxy for "is the output calibrated to grade band?". */
      difficulty: number;
    }>;
    /** Lesson-concept terms expected to appear in the questions.
     *  Drift = how many of these the candidate output covers. */
    concept_coverage: string[];
  };
  metadata: TupleMetadata;
}

// ── Homework generation ──────────────────────────────────────────
export interface HomeworkGenerationEvalTuple {
  id: string;
  scope: 'homework-generation';
  input: {
    lesson_plan_summary: string;
    student_profile_summary: string;
    comprehension_band: 'reteach' | 'grade_level' | 'advanced';
    learning_style: string;
    iep_accommodations: string[];
  };
  expected_output: {
    task_count: number;
    /** Each task's expected modality + concept tag. */
    tasks: Array<{
      modality: 'read' | 'write' | 'draw' | 'discuss' | 'create' | 'analyze';
      concept_tag: string;
      /** Difficulty signature on a 0..1 scale. */
      difficulty: number;
    }>;
    /** Reading-comp gate: when true, the modality 'discuss' should
     *  not appear (locked rule — students can't bypass reading by
     *  talking). */
    reading_comprehension_locked: boolean;
  };
  metadata: TupleMetadata;
}

// ── SPARK simulation generation ──────────────────────────────────
export interface SparkGenerationEvalTuple {
  id: string;
  scope: 'spark-generation';
  input: {
    lesson_plan_summary: string;
    student_profile_summary: string;
    comprehension_band: 'reteach' | 'grade_level' | 'advanced';
    learning_style: string;
    grade_band: string;
  };
  expected_output: {
    /** All nine SPARK sections must be present (S → P → A → R → K
     *  plus Tiered Inputs, Strategy Layer, Outputs, TELI/Reflection).
     *  Structural drift = missing sections. */
    sections_present: {
      scenario: boolean;
      problem: boolean;
      action: boolean;
      reflection: boolean;
      knowledge_transfer: boolean;
      tiered_inputs: boolean;
      strategy_layer: boolean;
      outputs: boolean;
      teli_block: boolean;
    };
    /** Lesson-concept terms expected to anchor the simulation. */
    concept_anchors: string[];
  };
  metadata: TupleMetadata;
}

// ── SPARK rubric scoring ─────────────────────────────────────────
// TODO(Stage B / Barb): reconcile SparkRubric dimension keys with SPARK's 7 canonical dimensions before activating the spark-rubric scope
export interface SparkRubricEvalTuple {
  id: string;
  scope: 'spark-rubric';
  input: {
    /** Student response to a scored SPARK challenge. */
    student_response: string;
    rubric_definitions: Record<string, string>;
    grade_band: string;
  };
  expected_output: {
    /** Seven dimension scores on the 1..4 rubric. Drift =
     *  abs(candidate - expected) per dimension; aggregate = mean. */
    dimensions: {
      reasoning_strategy: number;
      analysis_evidence: number;
      creativity_application: number;
      communication: number;
      collaboration: number | null;
      metacognition: number;
      growth_mindset: number;
    };
    /** content_quality classification — locked enum (Critical Bug
     *  May 2026 #X). Drift on this is binary (correct or not). */
    content_quality: 'engaged' | 'minimal' | 'non_engaged';
  };
  metadata: TupleMetadata;
}

// ── Learner Profile generation ───────────────────────────────────
export interface LearnerProfileEvalTuple {
  id: string;
  scope: 'learner-profile';
  input: {
    rubric_dimensions: SparkRubricEvalTuple['expected_output']['dimensions'];
    student_profile_summary: string;
    grade_band: string;
  };
  expected_output: {
    /** Five sections. Drift per section = semantic similarity +
     *  voice-rule compliance per audience. */
    short_narrative: { student: string; parent: string; teacher: string };
    strongest_signals: { student: string; parent: string; teacher: string };
    growth_areas: { student: string; parent: string; teacher: string };
    /** Teacher-only fields. */
    teacher_prompt: string;
    teacher_takeaway: string;
  };
  metadata: TupleMetadata;
}

// ── Discriminated union ──────────────────────────────────────────
export type EvalTuple =
  | GradingEvalTuple
  | QuizGenerationEvalTuple
  | HomeworkGenerationEvalTuple
  | SparkGenerationEvalTuple
  | SparkRubricEvalTuple
  | LearnerProfileEvalTuple;

export type EvalScope = EvalTuple['scope'];

export const ALL_SCOPES: readonly EvalScope[] = [
  'grading',
  'quiz-generation',
  'homework-generation',
  'spark-generation',
  'spark-rubric',
  'learner-profile',
] as const;

// ── Drift result ─────────────────────────────────────────────────
export interface TupleDrift {
  tuple_id: string;
  /** 0..1 — 0 means identical, 1 means maximally drifted. */
  drift_score: number;
  /** Tier per the threshold policy in the design doc. */
  tier: 'pass' | 'warning' | 'regression';
  /** Per-dimension breakdown (numeric drift, semantic drift, voice
   *  rule drift, structural drift). Consumer-readable for diagnosis;
   *  the aggregate `drift_score` is the gate. */
  components: Record<string, number>;
  /** Free-text notes — voice rule violations, missing structural
   *  fields, etc. Surfaced in the markdown report. */
  failures: string[];
}

export interface RunReport {
  scope: EvalScope;
  variant_label: string;
  baseline_label: string | null;
  /** ISO timestamp. */
  ran_at: string;
  total_tuples: number;
  /** Histogram of tuple tiers. */
  tier_counts: Record<TupleDrift['tier'], number>;
  /** Tuples that landed in the warning or regression tiers. */
  flagged: TupleDrift[];
  /** Aggregate drift score across all tuples (mean). */
  mean_drift: number;
  /** Pass/fail gate per the threshold policy. */
  gate: 'pass' | 'warning' | 'regression';
  gate_reason: string;
}
