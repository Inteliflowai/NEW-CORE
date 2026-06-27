// ============================================================
// src/lib/chapters/chapterTemplates.ts
//
// Locked template definitions for chapter tests (ported from V1 verbatim).
// Both templates are 44 minutes total, 60 points total, 5 sections.
//
// Humanities and STEM differ ONLY in section 5:
//   - humanities: Mini Essay (Power Paragraph, claim/evidence/explanation)
//   - stem:       Multi-Step Problem (setup/given + work + result + interpret)
//
// Sections 1-4 use the same shape with content shifted to subject
// domain at generation time (vocab in §1 becomes notation/units for
// STEM; compare-contrast in §3 becomes equations/methods for STEM;
// data interp in §4 stays roughly the same — graphs/lab data are
// already STEM's home turf).
//
// power_skill values map to Inteliflow Power Skills:
//   foundational — vocabulary recall, definitions
//   think        — short answer + compare/contrast (analysis)
//   research     — data interpretation
//   communicate  — mini essay (humanities only)
//
// STEM §5 (multi_step_problem) uses 'think' since it's analytical
// problem-solving rather than written communication.
//
// `question_count` is the number of question_rows the section
// contains for ONE student. Per-student differentiation means each
// row is unique to that student, but the count is the same across
// students for cleanliness.
//
// `time_minutes`, `total_points`, and `question_count` together pin
// the structural shape — drift-locked by chapterTemplates.test.ts.
// ============================================================

export type ChapterTestTemplate = 'humanities' | 'stem';

export type SectionKind =
  | 'vocabulary'
  | 'short_answer'
  | 'compare_contrast'
  | 'data_interpretation'
  | 'mini_essay'
  | 'multi_step_problem';

export type PowerSkill = 'foundational' | 'think' | 'research' | 'communicate';

export interface SectionDefinition {
  /** 1-indexed position within the test (matches DB chapter_test_sections.section_order). */
  order: number;
  kind: SectionKind;
  title: string;
  time_minutes: number;
  total_points: number;
  power_skill: PowerSkill;
  /** Number of question rows generated per student in this section. */
  question_count: number;
}

export interface TemplateDefinition {
  template: ChapterTestTemplate;
  total_minutes: 44;
  total_points: 60;
  sections: ReadonlyArray<SectionDefinition>;
}

// ── Humanities template ─────────────────────────────────────
export const HUMANITIES_TEMPLATE: TemplateDefinition = {
  template: 'humanities',
  total_minutes: 44,
  total_points: 60,
  sections: [
    {
      order: 1,
      kind: 'vocabulary',
      title: 'Vocabulary',
      time_minutes: 8,
      total_points: 10,
      power_skill: 'foundational',
      // 5 matching terms (1pt each, 5pt total) + 1 use-in-context (5pt) = 6 question rows
      question_count: 6,
    },
    {
      order: 2,
      kind: 'short_answer',
      title: 'Short Answer',
      time_minutes: 10,
      total_points: 15,
      power_skill: 'think',
      // 2 questions: explain why (~7pt) + apply/interpret (~8pt)
      question_count: 2,
    },
    {
      order: 3,
      kind: 'compare_contrast',
      title: 'Compare & Contrast',
      time_minutes: 8,
      total_points: 10,
      power_skill: 'think',
      // 1 prompt with 3 sub-parts (similarity, difference, significance)
      question_count: 1,
    },
    {
      order: 4,
      kind: 'data_interpretation',
      title: 'Data Interpretation',
      time_minutes: 10,
      total_points: 15,
      power_skill: 'research',
      // 1 visual + 3 questions (notice / mean / apply) = 3 question rows
      question_count: 3,
    },
    {
      order: 5,
      kind: 'mini_essay',
      title: 'Power Paragraph',
      time_minutes: 8,
      total_points: 10,
      power_skill: 'communicate',
      // ONE paragraph: claim + evidence + explanation
      question_count: 1,
    },
  ],
} as const;

// ── STEM template ─────────────────────────────────────────────
// Sections 1-4 same as humanities (content shift only at gen time);
// §5 swap to multi_step_problem. Same time/points/order shape.
export const STEM_TEMPLATE: TemplateDefinition = {
  template: 'stem',
  total_minutes: 44,
  total_points: 60,
  sections: [
    HUMANITIES_TEMPLATE.sections[0], // vocabulary (notation/units in STEM context)
    HUMANITIES_TEMPLATE.sections[1], // short_answer (explain principle / predict)
    HUMANITIES_TEMPLATE.sections[2], // compare_contrast (equations/methods/systems)
    HUMANITIES_TEMPLATE.sections[3], // data_interpretation (graphs/lab data — STEM's home turf)
    {
      order: 5,
      kind: 'multi_step_problem',
      title: 'Multi-Step Problem',
      time_minutes: 8,
      total_points: 10,
      power_skill: 'think',
      // ONE problem: setup/given + work shown + result + interpret/verify
      question_count: 1,
    },
  ],
} as const;

/**
 * Get the template definition for a given template id. Used by the
 * generation orchestrator to drive the section creation step.
 */
export function getTemplate(template: ChapterTestTemplate): TemplateDefinition {
  return template === 'stem' ? STEM_TEMPLATE : HUMANITIES_TEMPLATE;
}

/**
 * Total points across all sections — should always be 60. Exposed
 * for sanity checks during chapter test creation.
 */
export function totalPoints(template: TemplateDefinition): number {
  return template.sections.reduce((sum, s) => sum + s.total_points, 0);
}

/**
 * Total minutes across all sections — should always be 44. Exposed
 * for sanity checks during chapter test creation.
 */
export function totalMinutes(template: TemplateDefinition): number {
  return template.sections.reduce((sum, s) => sum + s.time_minutes, 0);
}
