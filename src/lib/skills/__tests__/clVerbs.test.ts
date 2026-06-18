import { describe, it, expect } from 'vitest';
import { CL_VERB_BY_STATE } from '../clVerbs';
import type { SkillLearningState } from '../clVerbs';

describe('CL_VERB_BY_STATE', () => {
  it('needs_different_instruction → Reinforce', () => {
    expect(CL_VERB_BY_STATE['needs_different_instruction']).toBe('Reinforce');
  });
  it('needs_more_time → Reinforce', () => {
    expect(CL_VERB_BY_STATE['needs_more_time']).toBe('Reinforce');
  });
  it('on_track → On Track', () => {
    expect(CL_VERB_BY_STATE['on_track']).toBe('On Track');
  });
  it('ready_to_extend → Enrich', () => {
    expect(CL_VERB_BY_STATE['ready_to_extend']).toBe('Enrich');
  });
  it('insufficient_data → null', () => {
    expect(CL_VERB_BY_STATE['insufficient_data']).toBeNull();
  });
  it('not_attempted → null', () => {
    expect(CL_VERB_BY_STATE['not_attempted']).toBeNull();
  });
  it('covers all 6 SkillLearningState values', () => {
    const states: SkillLearningState[] = [
      'needs_different_instruction', 'needs_more_time', 'on_track',
      'ready_to_extend', 'insufficient_data', 'not_attempted',
    ];
    for (const s of states) {
      expect(s in CL_VERB_BY_STATE).toBe(true);
    }
  });
});
