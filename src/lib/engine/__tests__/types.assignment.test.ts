import { describe, it, expect } from 'vitest';
import { AssignmentSchema } from '@/lib/engine/types';

const base = {
  title: 'T', mode: 'standard', learning_style: 'visual',
  reading_passage: 'p', audio_script: 'a', diagram_mode: 'none' as const,
  diagram_description: null, diagram_svg_prompt: null, diagram_image_prompt: null,
  youtube_search_query: 'q', instructions: 'i', atl_summary: [], ib_attributes: [],
};
const task = { step: 1, description: 'd', type: 'write' as const, strategy: 's', atl_skill: 'a', ib_attribute: 'i', bloom_level: 'Understand' };

describe('AssignmentSchema per-skill fields', () => {
  it('accepts tasks WITH skill_id/skill_name/power_skill', () => {
    const r = AssignmentSchema.safeParse({ ...base, tasks: [
      { ...task, skill_id: 'frac', skill_name: 'Fractions', power_skill: 'Monitor' },
      { ...task, step: 2, skill_id: 'dec', skill_name: 'Decimals', power_skill: 'Analyze' },
    ] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tasks[0].skill_name).toBe('Fractions');
  });
  it('still accepts legacy untagged tasks (backward compat)', () => {
    const r = AssignmentSchema.safeParse({ ...base, tasks: [task, { ...task, step: 2 }] });
    expect(r.success).toBe(true);
  });
  it('tolerates a null skill_id (cold/degrade)', () => {
    const r = AssignmentSchema.safeParse({ ...base, tasks: [
      { ...task, skill_id: null, skill_name: 'Fractions', power_skill: 'Monitor' }, { ...task, step: 2 },
    ] });
    expect(r.success).toBe(true);
  });
});
