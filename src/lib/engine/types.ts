// src/lib/engine/types.ts
// CORE V2 — Engine shared I/O types + Zod output schemas.
// Locks each generation call's output to the V1 prompt contract.
import { z } from 'zod';

// ── #1 Lesson parse (prompts.ts:272–289) ──────────────────────────────────────
export const ParsedLessonSchema = z.object({
  title: z.string().optional(),
  key_concepts: z.array(z.string()).default([]),
  objectives: z.array(z.string()).default([]),
  vocabulary: z.array(z.object({ term: z.string(), definition: z.string() })).default([]),
  misconception_risks: z.array(z.string()).default([]),
  grade_level: z.string().optional(),
  subject: z.string().optional(),
  summary: z.string().optional(),
});
export type ParsedLesson = z.infer<typeof ParsedLessonSchema>;

// ── #2 Quiz gen (prompts.ts:328–387 / math 464–512) ──────────────────────────
// C24 correction: enforce real 3+2 structure.
//   Positions 1–3: question_type='mcq' (requires choices) OR 'numeric' (requires numeric_spec) for STEM
//   Positions 4–5: question_type='open' (requires rubric)
// A quiz violating this shape is a terminal generation failure.

const ChoiceSchema = z.object({ label: z.string(), text: z.string() });

// Discriminated question variants with required fields enforced per type
const McqQuestionSchema = z.object({
  position: z.number().int(),
  question_type: z.literal('mcq'),
  question_text: z.string(),
  choices: z.array(ChoiceSchema).min(2),   // required for MCQ
  correct_answer: z.string().optional(),
  rubric: z.string().optional(),
  numeric_spec: z.undefined().optional(),
  concept_tag: z.string().optional(),
});

const OpenQuestionSchema = z.object({
  position: z.number().int(),
  question_type: z.literal('open'),
  question_text: z.string(),
  rubric: z.string().min(1),               // required for open
  choices: z.undefined().optional(),
  correct_answer: z.string().optional(),
  numeric_spec: z.undefined().optional(),
  concept_tag: z.string().optional(),
});

const NumericQuestionSchema = z.object({
  position: z.number().int(),
  question_type: z.literal('numeric'),
  question_text: z.string(),
  numeric_spec: z.object({               // required for numeric
    accepted: z.array(z.string()),
    tolerance: z.number().optional(),
  }),
  choices: z.undefined().optional(),
  correct_answer: z.string().optional(),
  rubric: z.string().optional(),
  concept_tag: z.string().optional(),
});

// A question at positions 1–3 must be mcq or numeric (STEM)
const FrontQuestionSchema = z.union([McqQuestionSchema, NumericQuestionSchema]);
// A question at positions 4–5 must be open
const BackQuestionSchema = OpenQuestionSchema;

export const GeneratedQuizSchema = z.object({
  title: z.string(),
  questions: z.tuple([
    FrontQuestionSchema,
    FrontQuestionSchema,
    FrontQuestionSchema,
    BackQuestionSchema,
    BackQuestionSchema,
  ]),
}).refine(
  (data) => data.questions.length === 5,
  { message: 'Quiz must have exactly 5 questions' },
);
export type GeneratedQuiz = z.infer<typeof GeneratedQuizSchema>;

// ── #3 Adapt Q4–Q5 (adapt/route.ts:117–141) ──────────────────────────────────
export const AdaptedQuestionsSchema = z.object({
  level: z.enum(['advanced', 'grade_level', 'scaffolded']),
  mcq_pct: z.number(),
  questions: z.array(z.object({
    position: z.number().int(),
    question_text: z.string(),
    rubric: z.string(),
    scaffold_hint: z.string(),
    difficulty_label: z.string(),
  })).length(2),
});
export type AdaptedQuestions = z.infer<typeof AdaptedQuestionsSchema>;

// ── #4 OEQ grading (prompts.ts:583–594) — locked enums ───────────────────────
export const GradingResultSchema = z.object({
  score: z.union([z.literal(0), z.literal(0.5), z.literal(1.0)]),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
  grader_source: z.string(),
  error_type: z.enum([
    'none', 'factual_error', 'reasoning_gap', 'incomplete',
    'misunderstood_question', 'vocabulary_confusion', 'off_topic', 'blank',
  ]),
  reasoning_pattern: z.enum([
    'surface_recall', 'partial_reasoning', 'full_reasoning',
    'misconception', 'creative_extension', 'blank_or_off_topic',
  ]),
  misinterpretation_detected: z.boolean(),
  vocabulary_difficulty: z.enum(['none', 'low', 'medium', 'high']),
  cognitive_notes: z.string(),
});
export type GradingResult = z.infer<typeof GradingResultSchema>;

// ── #5a Learning style (prompts.ts:668–673) ──────────────────────────────────
// C6 correction: exactly 6 values from V1's learningStylePrompt.
// Do NOT include 'social'. DB normalization (read_write→text / tactile→kinesthetic)
// happens in the assignment route, not here.
export const LearningStyleSchema = z.object({
  learning_style: z.enum(['visual', 'auditory', 'read_write', 'kinesthetic', 'tactile', 'emerging']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});
export type LearningStyle = z.infer<typeof LearningStyleSchema>;

// ── #5 Assignment (prompts.ts:998–1026) ───────────────────────────────────────
const AssignmentTaskSchema = z.object({
  step: z.number().int(),
  description: z.string(),
  type: z.enum(['read', 'write', 'draw', 'discuss', 'create', 'analyze']),
  strategy: z.string(),
  atl_skill: z.string(),
  ib_attribute: z.string(),
  bloom_level: z.string(),
  // CL → generation: per-skill section tagging. Optional so an untagged (single-band)
  // or partially-tagged LLM response still parses (never fabricate / never hard-fail).
  skill_id: z.string().nullable().optional(),
  skill_name: z.string().optional(),
  power_skill: z.string().optional(),
});
export const AssignmentSchema = z.object({
  title: z.string(),
  mode: z.string(),
  learning_style: z.string(),
  reading_passage: z.string().min(1),
  audio_script: z.string().min(1),
  diagram_mode: z.enum(['image', 'structured', 'none']),
  diagram_description: z.string().nullable(),
  diagram_svg_prompt: z.string().nullable(),
  diagram_image_prompt: z.string().nullable(),
  youtube_search_query: z.string(),
  instructions: z.string(),
  tasks: z.array(AssignmentTaskSchema).min(2),
  support_note: z.string().optional(),
  extension_prompt: z.string().optional(),
  atl_summary: z.array(z.string()).default([]),
  ib_attributes: z.array(z.string()).default([]),
});
export type Assignment = z.infer<typeof AssignmentSchema>;

// ── #6 Lesson generate (Seg 2) — reuses the parse contract + AI-proposed standards ──
export const ProposedStandardSchema = z.object({
  code: z.string(),
  description: z.string(),
});
export type ProposedStandard = z.infer<typeof ProposedStandardSchema>;

export const GeneratedLessonSchema = ParsedLessonSchema.extend({
  proposed_standards: z.array(ProposedStandardSchema).default([]),
});
export type GeneratedLesson = z.infer<typeof GeneratedLessonSchema>;

// ── #7 Unit segmentation (Seg 2 multi-day) ──
export const UnitSegmentSchema = z.object({
  day: z.number().int(),
  title: z.string(),
  focus: z.string(),
});
export type UnitSegment = z.infer<typeof UnitSegmentSchema>;

export const UnitSegmentsSchema = z.object({
  unit_title: z.string(),
  days: z.array(UnitSegmentSchema).min(1),
});
export type UnitSegments = z.infer<typeof UnitSegmentsSchema>;
