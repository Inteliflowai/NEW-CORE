import { describe, it, expect } from 'vitest';
import { skillTone, sortSkillMap, isTailRow } from '../skillMapOrder';

describe('skillTone', () => {
  it('maps verbs to tones; null → not-yet', () => {
    expect(skillTone('Reinforce')).toBe('reinforce');
    expect(skillTone('On Track')).toBe('on-track');
    expect(skillTone('Enrich')).toBe('enrich');
    expect(skillTone(null)).toBe('not-yet');
  });
});

describe('sortSkillMap', () => {
  it('orders Reinforce → Not-yet → On Track → Enrich', () => {
    const rows = [
      { cl_verb: 'Enrich' as const, id: 'e' },
      { cl_verb: 'On Track' as const, id: 'o' },
      { cl_verb: null, id: 'n' },
      { cl_verb: 'Reinforce' as const, id: 'r' },
    ];
    expect(sortSkillMap(rows).map((r) => r.id)).toEqual(['r', 'n', 'o', 'e']);
  });

  it('is stable enough to not mutate the input array', () => {
    const rows = [{ cl_verb: 'Enrich' as const }, { cl_verb: 'Reinforce' as const }];
    const out = sortSkillMap(rows);
    expect(rows[0].cl_verb).toBe('Enrich'); // original untouched
    expect(out[0].cl_verb).toBe('Reinforce');
  });
});

describe('isTailRow', () => {
  it('treats On Track and Enrich as the collapsible tail', () => {
    expect(isTailRow('On Track')).toBe(true);
    expect(isTailRow('Enrich')).toBe(true);
  });
  it('keeps Reinforce and Not-yet always visible', () => {
    expect(isTailRow('Reinforce')).toBe(false);
    expect(isTailRow(null)).toBe(false);
  });
});
