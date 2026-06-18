// src/lib/misconceptions/taxonomy.ts
// Single source of truth for the ratified 8 error_type + 6 reasoning_pattern codes.
// Display labels mirror migration 0011's misconception_types seed rows (C5: byte-match).
// Pure — no imports from next/server, no DB calls, no module-load side effects.

export const ERROR_TYPES = [
  'none',
  'factual_error',
  'reasoning_gap',
  'incomplete',
  'misunderstood_question',
  'vocabulary_confusion',
  'off_topic',
  'blank',
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

export const REASONING_PATTERNS = [
  'surface_recall',
  'partial_reasoning',
  'full_reasoning',
  'misconception',
  'creative_extension',
  'blank_or_off_topic',
] as const;

export type ReasoningPattern = (typeof REASONING_PATTERNS)[number];

/** Seed rows for migration 0011's misconception_types table (C5: byte-match the INSERT). */
export const MISCONCEPTION_TYPE_ROWS: {
  code: string;
  kind: 'error_type' | 'reasoning_pattern';
  display_label: string;
  sort_order: number;
  active: boolean;
}[] = [
  // error_type codes (8 — verbatim from migration 0011)
  { code: 'none',                   kind: 'error_type',        display_label: 'No error',                 sort_order: 1, active: true },
  { code: 'factual_error',          kind: 'error_type',        display_label: 'Factual error',            sort_order: 2, active: true },
  { code: 'reasoning_gap',          kind: 'error_type',        display_label: 'Incomplete reasoning',     sort_order: 3, active: true },
  { code: 'incomplete',             kind: 'error_type',        display_label: 'Incomplete response',      sort_order: 4, active: true },
  { code: 'misunderstood_question', kind: 'error_type',        display_label: 'Misunderstood question',   sort_order: 5, active: true },
  { code: 'vocabulary_confusion',   kind: 'error_type',        display_label: 'Vocabulary confusion',     sort_order: 6, active: true },
  { code: 'off_topic',              kind: 'error_type',        display_label: 'Off-topic response',       sort_order: 7, active: true },
  { code: 'blank',                  kind: 'error_type',        display_label: 'Blank or no response',     sort_order: 8, active: true },
  // reasoning_pattern codes (6 — verbatim from migration 0011)
  { code: 'surface_recall',         kind: 'reasoning_pattern', display_label: 'Surface recall',           sort_order: 1, active: true },
  { code: 'partial_reasoning',      kind: 'reasoning_pattern', display_label: 'Partial reasoning',        sort_order: 2, active: true },
  { code: 'full_reasoning',         kind: 'reasoning_pattern', display_label: 'Full reasoning',           sort_order: 3, active: true },
  { code: 'misconception',          kind: 'reasoning_pattern', display_label: 'Misconception',            sort_order: 4, active: true },
  { code: 'creative_extension',     kind: 'reasoning_pattern', display_label: 'Creative extension',       sort_order: 5, active: true },
  { code: 'blank_or_off_topic',     kind: 'reasoning_pattern', display_label: 'Blank or off-topic',       sort_order: 6, active: true },
];
