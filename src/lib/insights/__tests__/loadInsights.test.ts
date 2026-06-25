import { describe, it, expect, vi } from 'vitest';
import { loadInsights } from '@/lib/insights/loadInsights';
import * as roster from '@/lib/signals/loadRosterSignals';

vi.mock('@/lib/insights/loadClassComprehension', () => ({
  loadClassComprehension: async () => ({ skills: [], trend: { points: [], direction: null } }),
}));
vi.mock('@/lib/insights/loadClassLearningStyle', () => ({
  loadClassLearningStyle: async () => ({ styles: [], line: null }),
}));

function fakeRoster(bands: (string | null)[], gaps?: roster.RosterSignals['concept_gaps']) {
  return {
    class_id: 'c1',
    roster: bands.map((b, i) => ({ student_id: `s${i}`, full_name: `S ${i}`, band: b, volatile: false, risk: { risk_score: 0, risk_level: 'low', risk_factors: [] } })),
    focus_group: [],
    concept_gaps: gaps ?? [
      { question_index: 0, question_text: 'sk_a', skill_name: 'Fractions', pct_incorrect: 60 },
      { question_index: 1, question_text: 'sk_b', skill_name: null, pct_incorrect: 30 },
    ],
  } as roster.RosterSignals;
}

describe('loadInsights', () => {
  it('tallies the band mix and carries skill gaps as WORDS (skipping unnamed skills, no fabricated count)', async () => {
    vi.spyOn(roster, 'loadRosterSignals').mockResolvedValue(
      fakeRoster(['reteach', 'reteach', 'grade_level', 'advanced', null]),
    );
    const r = await loadInsights({} as never, { classId: 'c1' });
    expect(r.band_mix).toMatchObject({ needs_reinforcement: 2, on_track: 1, ready_to_enrich: 1, not_assessed: 1, total: 5 });
    // New shape: { skill_name, phrase } — words, never a count. pct_incorrect 60 → "most".
    expect(r.concept_gaps).toEqual([{ skill_name: 'Fractions', phrase: 'most' }]); // unnamed skill dropped
    // No fabricated count fields leak through and no digit reaches the rendered output.
    for (const g of r.concept_gaps) {
      expect(g).not.toHaveProperty('needs_count');
      expect(g).not.toHaveProperty('total');
      expect(`${g.skill_name} — ${g.phrase}`).not.toMatch(/\d/);
    }
    expect(typeof r.observation === 'string' || r.observation === null).toBe(true);
  });

  it('drops a gap whose admin-authored skill_name contains a banned word', async () => {
    vi.spyOn(roster, 'loadRosterSignals').mockResolvedValue(
      fakeRoster(['grade_level'], [
        { question_index: 0, question_text: 'sk_a', skill_name: 'Fractions', pct_incorrect: 60 },
        // "Risk Score Estimation" carries the banned word "score" → must be dropped.
        { question_index: 1, question_text: 'sk_b', skill_name: 'Risk Score Estimation', pct_incorrect: 90 },
      ]),
    );
    const r = await loadInsights({} as never, { classId: 'c1' });
    expect(r.concept_gaps).toEqual([{ skill_name: 'Fractions', phrase: 'most' }]);
    expect(r.concept_gaps.some((g) => /score/i.test(g.skill_name))).toBe(false);
  });
});
