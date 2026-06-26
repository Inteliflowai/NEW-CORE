import { describe, it, expect } from 'vitest';
import { assignmentPrompt, type AssignmentSection } from '@/lib/openai/prompts';

const sections: AssignmentSection[] = [
  { skill_id: 'frac', skill_name: 'Fractions', level: 'scaffolded',
    strategies: [{ name: 'Text Detective', what_students_do: 'hunt for clues', atl_skills: ['Thinking'], ib_learner_profile: ['Thinkers'], bloom_level: 'Understand', power_skill: 'Monitor' }] },
  { skill_id: 'dec', skill_name: 'Decimals', level: 'extension',
    strategies: [{ name: 'Idea Mapping', what_students_do: 'map ideas', atl_skills: ['Thinking'], ib_learner_profile: ['Thinkers'], bloom_level: 'Analyze', power_skill: 'Analyze' }] },
];

describe('assignmentPrompt sectioned variant', () => {
  const p = assignmentPrompt('LESSON', 'grade_level', 'visual', 'Maria', undefined, false, false, sections);
  it('lists each skill section in order with its level + power skill', () => {
    expect(p).toContain('SKILL SECTIONS');
    expect(p.indexOf('Fractions')).toBeLessThan(p.indexOf('Decimals')); // order preserved
    expect(p).toContain('SCAFFOLDED RETEACH'); // frac level label
    expect(p).toContain('EXTENSION ADVANCED'); // dec level label
    expect(p).toContain('Power skill: Monitor');
  });
  it('asks every task to carry skill_id, skill_name, and power_skill', () => {
    expect(p).toContain('"skill_id"');
    expect(p).toContain('"skill_name"');
    expect(p).toContain('"power_skill"');
  });
  it('omits the section block entirely when no sections (single-band path unchanged)', () => {
    const single = assignmentPrompt('LESSON', 'grade_level', 'visual', 'Maria');
    expect(single).not.toContain('SKILL SECTIONS');
    expect(single).not.toContain('"power_skill"');
  });
});
