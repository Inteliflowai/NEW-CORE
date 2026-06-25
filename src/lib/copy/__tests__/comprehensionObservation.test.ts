import { describe, it, expect } from 'vitest';
import { comprehensionObservation } from '@/lib/copy/comprehensionObservation';
import type { SkillComprehension } from '@/lib/insights/loadClassComprehension';

const mk = (name: string, reinforce: number): SkillComprehension => ({
  skill_id: name, skill_name: name, reinforce, on_track: 0, enrich: 0,
  reinforce_students: [], on_track_students: [], enrich_students: [],
});

describe('comprehensionObservation', () => {
  it('names the top reinforce skill (skills are pre-sorted most-reinforce-first)', () => {
    expect(comprehensionObservation([mk('Equivalent fractions', 3), mk('Long division', 1)]))
      .toBe('3 students need another pass on Equivalent fractions.');
  });
  it('singularizes one student', () => {
    expect(comprehensionObservation([mk('Fractions', 1)])).toBe('One student needs another pass on Fractions.');
  });
  it('null when nothing needs reinforcement', () => {
    expect(comprehensionObservation([])).toBeNull();
  });
});
