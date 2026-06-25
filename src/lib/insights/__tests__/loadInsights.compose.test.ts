import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/signals/loadRosterSignals', () => ({
  loadRosterSignals: async () => ({
    class_id: 'c1',
    roster: [{ student_id: 's1', full_name: 'Ava', band: 'reteach', volatile: false, risk: {} }],
    focus_group: [],
    concept_gaps: [],
  }),
}));
vi.mock('@/lib/insights/loadClassComprehension', () => ({
  loadClassComprehension: async () => ({
    skills: [{ skill_id: 'sk1', skill_name: 'Fractions', reinforce: 2, on_track: 1, enrich: 0,
      reinforce_students: [], on_track_students: [], enrich_students: [] }],
    trend: { points: [], direction: null },
  }),
}));
vi.mock('@/lib/insights/loadClassLearningStyle', () => ({
  loadClassLearningStyle: async () => ({ styles: ['visual', 'hands-on'], line: 'Your class spans visual and hands-on learners — assignments differentiate to each.' }),
}));

describe('loadInsights composition', () => {
  it('includes comprehension + learning_style, and leads with a comprehension sentence', async () => {
    const { loadInsights } = await import('@/lib/insights/loadInsights');
    const out = await loadInsights({} as never, { classId: 'c1' });
    expect(out.band_mix.total).toBe(1);
    expect(out.comprehension.skills[0].skill_name).toBe('Fractions');
    expect(out.learning_style.line).toContain('differentiate');
    expect(out.observation).toBe('2 students need another pass on Fractions.');
  });
});
