// src/lib/misconceptions/__tests__/taxonomy.test.ts
// Verifies that taxonomy.ts MISCONCEPTION_TYPE_ROWS byte-match the 0011 migration seed (C5).
import { describe, it, expect } from 'vitest';
import { MISCONCEPTION_TYPE_ROWS, ERROR_TYPES, REASONING_PATTERNS } from '../taxonomy';

// Migration 0011 seed — verbatim for comparison
const SEED_ROWS = [
  { code: 'none',                   kind: 'error_type',        display_label: 'No error',                sort_order: 1, active: true },
  { code: 'factual_error',          kind: 'error_type',        display_label: 'Factual error',           sort_order: 2, active: true },
  { code: 'reasoning_gap',          kind: 'error_type',        display_label: 'Incomplete reasoning',    sort_order: 3, active: true },
  { code: 'incomplete',             kind: 'error_type',        display_label: 'Incomplete response',     sort_order: 4, active: true },
  { code: 'misunderstood_question', kind: 'error_type',        display_label: 'Misunderstood question',  sort_order: 5, active: true },
  { code: 'vocabulary_confusion',   kind: 'error_type',        display_label: 'Vocabulary confusion',    sort_order: 6, active: true },
  { code: 'off_topic',              kind: 'error_type',        display_label: 'Off-topic response',      sort_order: 7, active: true },
  { code: 'blank',                  kind: 'error_type',        display_label: 'Blank or no response',    sort_order: 8, active: true },
  { code: 'surface_recall',         kind: 'reasoning_pattern', display_label: 'Surface recall',          sort_order: 1, active: true },
  { code: 'partial_reasoning',      kind: 'reasoning_pattern', display_label: 'Partial reasoning',       sort_order: 2, active: true },
  { code: 'full_reasoning',         kind: 'reasoning_pattern', display_label: 'Full reasoning',          sort_order: 3, active: true },
  { code: 'misconception',          kind: 'reasoning_pattern', display_label: 'Misconception',           sort_order: 4, active: true },
  { code: 'creative_extension',     kind: 'reasoning_pattern', display_label: 'Creative extension',      sort_order: 5, active: true },
  { code: 'blank_or_off_topic',     kind: 'reasoning_pattern', display_label: 'Blank or off-topic',      sort_order: 6, active: true },
];

describe('taxonomy', () => {
  it('has exactly 14 rows (8 error_type + 6 reasoning_pattern)', () => {
    expect(MISCONCEPTION_TYPE_ROWS).toHaveLength(14);
    const errorTypes = MISCONCEPTION_TYPE_ROWS.filter(r => r.kind === 'error_type');
    const reasoningPatterns = MISCONCEPTION_TYPE_ROWS.filter(r => r.kind === 'reasoning_pattern');
    expect(errorTypes).toHaveLength(8);
    expect(reasoningPatterns).toHaveLength(6);
  });

  it('MISCONCEPTION_TYPE_ROWS codes and labels byte-match migration 0011 seed (C5)', () => {
    for (const seed of SEED_ROWS) {
      const row = MISCONCEPTION_TYPE_ROWS.find(r => r.code === seed.code);
      expect(row, `Missing row for code: ${seed.code}`).toBeDefined();
      expect(row!.kind).toBe(seed.kind);
      expect(row!.display_label).toBe(seed.display_label);
      expect(row!.sort_order).toBe(seed.sort_order);
      expect(row!.active).toBe(seed.active);
    }
  });

  it('ERROR_TYPES contains all 8 ratified error_type codes', () => {
    const errorTypeCodes = MISCONCEPTION_TYPE_ROWS
      .filter(r => r.kind === 'error_type')
      .map(r => r.code);
    for (const code of errorTypeCodes) {
      expect(ERROR_TYPES).toContain(code);
    }
    expect(ERROR_TYPES).toHaveLength(8);
  });

  it('REASONING_PATTERNS contains all 6 ratified reasoning_pattern codes', () => {
    const reasoningCodes = MISCONCEPTION_TYPE_ROWS
      .filter(r => r.kind === 'reasoning_pattern')
      .map(r => r.code);
    for (const code of reasoningCodes) {
      expect(REASONING_PATTERNS).toContain(code);
    }
    expect(REASONING_PATTERNS).toHaveLength(6);
  });
});
