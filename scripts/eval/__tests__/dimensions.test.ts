import { describe, it, expect } from 'vitest';
import { SPARK_RUBRIC_DIMENSIONS } from '../dimensions';
import type { SparkRubricEvalTuple } from '../types';

describe('SPARK rubric dimensions (§11.4 / spark-mining-findings §4)', () => {
  it('is exactly SPARK runtime canonical 7', () => {
    expect([...SPARK_RUBRIC_DIMENSIONS].sort()).toEqual([
      'collaboration', 'communication', 'creativity_application', 'problem_understanding',
      'reasoning_strategy', 'reflection_metacognition', 'use_of_evidence',
    ].sort());
  });
  it('the rubric tuple keys match the canonical set (compile-time + runtime)', () => {
    const dims: SparkRubricEvalTuple['expected_output']['dimensions'] = {
      reasoning_strategy: 3, use_of_evidence: 3, creativity_application: 2, communication: 3,
      collaboration: null, reflection_metacognition: 2, problem_understanding: 3,
    };
    for (const k of Object.keys(dims)) expect(SPARK_RUBRIC_DIMENSIONS).toContain(k);
    // the deleted/renamed keys must not exist on the type
    // @ts-expect-error — analysis_evidence was renamed to use_of_evidence
    expect(dims.analysis_evidence).toBeUndefined();
    // @ts-expect-error — metacognition was renamed to reflection_metacognition
    expect(dims.metacognition).toBeUndefined();
    // @ts-expect-error — growth_mindset was deleted (not a SPARK dimension)
    expect(dims.growth_mindset).toBeUndefined();
  });
});
