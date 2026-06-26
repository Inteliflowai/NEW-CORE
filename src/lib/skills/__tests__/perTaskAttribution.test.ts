import { describe, it, expect } from 'vitest';
import { extractTaskSkillTags, buildPerSkillHomeworkObs } from '@/lib/skills/perTaskAttribution';

describe('extractTaskSkillTags', () => {
  it('pulls (step, skill_id) for tagged tasks, ignoring untagged', () => {
    const out = extractTaskSkillTags({ tasks: [
      { step: 1, skill_id: 'frac' }, { step: 2, skill_id: 'dec' }, { step: 3, skill_id: null }, { step: 4 },
    ] });
    expect(out).toEqual([{ step: 1, skill_id: 'frac' }, { step: 2, skill_id: 'dec' }]);
  });
  it('returns [] for null/untagged content', () => {
    expect(extractTaskSkillTags(null)).toEqual([]);
    expect(extractTaskSkillTags({ tasks: [{ step: 1, description: 'd' } as never] })).toEqual([]);
  });
});

describe('buildPerSkillHomeworkObs', () => {
  const base = { submitted: true, occurredAt: '2026-06-26', effortLabel: 'independent_success' };
  it('produces ONE averaged observation per skill (no inflation)', () => {
    const m = buildPerSkillHomeworkObs(
      [{ step: 1, skill_id: 'frac' }, { step: 2, skill_id: 'frac' }, { step: 3, skill_id: 'dec' }],
      [{ step: 1, grade: 90 }, { step: 2, grade: 80 }, { step: 3, grade: 40 }],
      base,
    )!;
    expect(m.get('frac')).toMatchObject({ gradePct: 85, submitted: true, effortLabel: 'independent_success' }); // avg(90,80)
    expect(m.get('dec')).toMatchObject({ gradePct: 40 });
    expect(m.get('frac') && Array.isArray(m.get('frac'))).toBe(false); // single obs, not an array
  });
  it('returns null when there are no tags or no grades (caller falls back)', () => {
    expect(buildPerSkillHomeworkObs([], [{ step: 1, grade: 90 }], base)).toBeNull();
    expect(buildPerSkillHomeworkObs([{ step: 1, skill_id: 'frac' }], [], base)).toBeNull();
  });
  it('omits a skill whose tagged task has no matching grade (caller fan-out covers it)', () => {
    const m = buildPerSkillHomeworkObs([{ step: 1, skill_id: 'frac' }, { step: 2, skill_id: 'dec' }], [{ step: 1, grade: 70 }], base)!;
    expect(m.get('frac')).toMatchObject({ gradePct: 70 });
    expect(m.has('dec')).toBe(false);
  });
});
