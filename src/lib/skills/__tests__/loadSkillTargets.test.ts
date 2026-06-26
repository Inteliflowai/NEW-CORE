import { describe, it, expect } from 'vitest';
import { loadSkillTargets } from '@/lib/skills/loadSkillTargets';

// Minimal admin stub: skill_learning_state select → in() returns the seeded rows.
function adminWith(rows: { skill_id: string; state: string; confidence: number | null }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  } as never;
}

describe('loadSkillTargets', () => {
  it('returns [] when no skills given (no query)', async () => {
    const out = await loadSkillTargets({} as never, { studentId: 's1', skills: [], fallbackBand: 'grade_level' });
    expect(out).toEqual([]);
  });

  it('maps states to confident levels and cold skills to the fallback', async () => {
    const admin = adminWith([
      { skill_id: 'frac', state: 'needs_more_time', confidence: 80 },   // Reinforce
      { skill_id: 'dec', state: 'ready_to_extend', confidence: 75 },    // Enrich
      // 'geo' has no row → cold → fallback
    ]);
    const out = await loadSkillTargets(admin, {
      studentId: 's1',
      skills: [
        { skill_id: 'frac', skill_name: 'Fractions' },
        { skill_id: 'dec', skill_name: 'Decimals' },
        { skill_id: 'geo', skill_name: 'Geometry' },
      ],
      fallbackBand: 'grade_level', // → 'standard'
    });
    const byId = Object.fromEntries(out.map((t) => [t.skill_id, t]));
    expect(byId.frac.level).toBe('scaffolded');
    expect(byId.frac.verb).toBe('Reinforce');
    expect(byId.dec.level).toBe('extension');
    expect(byId.geo.level).toBe('standard'); // cold → fallback
    expect(byId.geo.verb).toBeNull();
    // ordering: Reinforce(frac) → Enrich(dec) → cold(geo)
    expect(out.map((t) => t.skill_id)).toEqual(['frac', 'dec', 'geo']);
  });

  it('treats low-confidence as cold (fallback level, confident=false)', async () => {
    const admin = adminWith([{ skill_id: 'frac', state: 'needs_more_time', confidence: 20 }]);
    const out = await loadSkillTargets(admin, {
      studentId: 's1', skills: [{ skill_id: 'frac', skill_name: 'Fractions' }], fallbackBand: 'advanced',
    });
    expect(out[0].level).toBe('extension'); // fallback = bandToAssignmentMode('advanced')
    expect(out[0].confident).toBe(false);
  });
});
