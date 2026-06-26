import { describe, it, expect, vi, afterEach } from 'vitest';
import { levelForVerb, orderAndCapTargets, SKILL_TARGET_CAP, type SkillTarget } from '@/lib/skills/skillTargets';
import { assignmentModeToBand, bandToAssignmentMode } from '@/lib/utils/scoring';

afterEach(() => vi.restoreAllMocks());

describe('levelForVerb', () => {
  it('maps confident verbs to levels', () => {
    expect(levelForVerb('Reinforce', 80, 'standard')).toBe('scaffolded');
    expect(levelForVerb('On Track', 80, 'scaffolded')).toBe('standard');
    expect(levelForVerb('Enrich', 80, 'standard')).toBe('extension');
  });
  it('falls back when verb is null (cold)', () => {
    expect(levelForVerb(null, 90, 'standard')).toBe('standard');
  });
  it('falls back when confidence is below the steer floor or null', () => {
    expect(levelForVerb('Reinforce', 39, 'standard')).toBe('standard');
    expect(levelForVerb('Reinforce', null, 'extension')).toBe('extension');
    expect(levelForVerb('Reinforce', 40, 'standard')).toBe('scaffolded'); // boundary: 40 steers
  });
});

describe('orderAndCapTargets', () => {
  const mk = (skill_id: string, verb: SkillTarget['verb']): SkillTarget =>
    ({ skill_id, skill_name: skill_id, level: 'standard', verb, confident: verb != null });

  it('orders Reinforce → On Track → Enrich → cold(null)', () => {
    const out = orderAndCapTargets([mk('a', 'Enrich'), mk('b', null), mk('c', 'Reinforce'), mk('d', 'On Track')]);
    expect(out.map((t) => t.skill_id)).toEqual(['c', 'd', 'a', 'b']);
  });
  it('caps at SKILL_TARGET_CAP and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const many = Array.from({ length: 6 }, (_, i) => mk(`s${i}`, 'Reinforce'));
    const out = orderAndCapTargets(many);
    expect(out).toHaveLength(SKILL_TARGET_CAP);
    expect(warn).toHaveBeenCalled();
  });
});

describe('assignmentModeToBand', () => {
  it('is the inverse of bandToAssignmentMode', () => {
    for (const band of ['reteach', 'grade_level', 'advanced'] as const) {
      expect(assignmentModeToBand(bandToAssignmentMode(band))).toBe(band);
    }
  });
});
