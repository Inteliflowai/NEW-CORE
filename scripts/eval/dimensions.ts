// SPARK's 7 canonical rubric dimensions — the SINGLE source (spec §11.4 / §7.3 #4).
// Root cause of the blocker: three hand-maintained copies drifted. Everything that
// names a rubric dimension imports THIS constant; key drift can no longer recur.
// Weights (spark-mining-findings §4, lib/analyzer/rubric.ts): problem_understanding .15,
// reasoning_strategy .20, use_of_evidence .20, creativity_application .10,
// communication .10, reflection_metacognition .15, collaboration .10.
export const SPARK_RUBRIC_DIMENSIONS = [
  'problem_understanding',
  'reasoning_strategy',
  'use_of_evidence',
  'creativity_application',
  'communication',
  'reflection_metacognition',
  'collaboration',
] as const;

export type SparkRubricDimension = (typeof SPARK_RUBRIC_DIMENSIONS)[number];

/** Load-bearing (strict-tier) dimensions — wider weighting in drift scoring. */
// DIVERGENCE FLAGGED (SCOPE wins): §11.2's strict set INCLUDES knowledge_transfer, but the §11.4 canonical 7 EXCLUDES it — Residual Open Question #7, pending Barb. NOT silently dropped; left out of the canonical 7 per §11.4 until Barb resolves.
// NOTE: content_quality is a SEPARATE binary x2 drift input (§11.2), NOT one of the 7 numeric dimensions. A later eval-rebuild plan wires it; the Task 11 spark-rubric interim fixture includes a content_quality field so the tuple matches the runner's read shape.
export const STRICT_DIMENSIONS: readonly SparkRubricDimension[] = [
  'reasoning_strategy', 'use_of_evidence', 'problem_understanding',
];
