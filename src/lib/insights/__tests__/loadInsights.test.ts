import { describe, it, expect, vi } from 'vitest';
import { loadInsights } from '@/lib/insights/loadInsights';
import * as roster from '@/lib/signals/loadRosterSignals';

function fakeRoster(bands: (string | null)[]) {
  return {
    class_id: 'c1',
    roster: bands.map((b, i) => ({ student_id: `s${i}`, full_name: `S ${i}`, band: b, volatile: false, risk: { risk_score: 0, risk_level: 'low', risk_factors: [] } })),
    focus_group: [],
    concept_gaps: [
      { question_index: 0, question_text: 'sk_a', skill_name: 'Fractions', pct_incorrect: 60 },
      { question_index: 1, question_text: 'sk_b', skill_name: null, pct_incorrect: 30 },
    ],
  } as roster.RosterSignals;
}

describe('loadInsights', () => {
  it('tallies the band mix and carries skill gaps (skipping unnamed skills)', async () => {
    vi.spyOn(roster, 'loadRosterSignals').mockResolvedValue(
      fakeRoster(['reteach', 'reteach', 'grade_level', 'advanced', null]),
    );
    const r = await loadInsights({} as never, { classId: 'c1' });
    expect(r.band_mix).toMatchObject({ needs_reinforcement: 2, on_track: 1, ready_to_enrich: 1, not_assessed: 1, total: 5 });
    expect(r.concept_gaps).toEqual([{ skill_name: 'Fractions', needs_count: expect.any(Number), total: 5 }]); // unnamed skill dropped
    expect(typeof r.observation === 'string' || r.observation === null).toBe(true);
  });
});
