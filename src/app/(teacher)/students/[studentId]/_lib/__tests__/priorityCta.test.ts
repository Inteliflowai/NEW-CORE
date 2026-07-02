import { describe, it, expect } from 'vitest';
import { priorityCta } from '../priorityCta';

const NO_SKILLS: { cl_verb: 'Reinforce' | 'On Track' | 'Enrich' | null; skill_name: string }[] = [];

describe('priorityCta precedence', () => {
  it('1. risk high/critical wins over everything', () => {
    const out = priorityCta({
      riskLevel: 'high',
      perSkillCl: [{ cl_verb: 'Reinforce', skill_name: 'Fractions' }],
      divergenceFlagged: true,
    });
    expect(out.kind).toBe('review-risk');
  });

  it('2. top Reinforce skill wins when risk is not elevated', () => {
    const out = priorityCta({
      riskLevel: 'low',
      perSkillCl: [
        { cl_verb: 'On Track', skill_name: 'Decimals' },
        { cl_verb: 'Reinforce', skill_name: 'Fractions' },
      ],
      divergenceFlagged: true,
    });
    expect(out.kind).toBe('flag-reteach');
    expect(out.label).toContain('Reinforce');
    expect(out.label).toContain('Fractions');
    expect(out.skillName).toBe('Fractions');
    expect(out.anchor).toBe('/gradebook');
  });

  it('3. divergence flagged wins when no risk + no reinforce skill', () => {
    const out = priorityCta({
      riskLevel: 'medium',
      perSkillCl: [{ cl_verb: 'On Track', skill_name: 'Decimals' }],
      divergenceFlagged: true,
    });
    expect(out.kind).toBe('leave-note');
  });

  it('4. falls back to Open Assignments', () => {
    const out = priorityCta({
      riskLevel: 'low',
      perSkillCl: NO_SKILLS,
      divergenceFlagged: false,
    });
    expect(out.kind).toBe('open-assignments');
    expect(out.anchor).toBe('/gradebook');
  });

  it('medium risk does NOT trigger review-risk (only high/critical)', () => {
    const out = priorityCta({
      riskLevel: 'medium',
      perSkillCl: NO_SKILLS,
      divergenceFlagged: false,
    });
    expect(out.kind).toBe('open-assignments');
  });
});
