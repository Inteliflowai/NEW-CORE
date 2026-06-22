import { describe, it, expect } from 'vitest';
import { buildHighFiveSuggestions, type SuggestionInput } from '@/lib/highfives/suggestions';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';

const mk = (p: Partial<SuggestionInput>): SuggestionInput => ({
  student_id: p.student_id ?? 's', full_name: p.full_name ?? 'Stu', band: p.band ?? 'grade_level',
  dominant_effort: p.dominant_effort ?? null, trajectory: p.trajectory ?? null,
  had_recent_reteach_win: p.had_recent_reteach_win ?? false, recent_high_five: p.recent_high_five ?? false,
});

describe('buildHighFiveSuggestions', () => {
  it('suggests reteach_completed and stretch with leak-free context hints', () => {
    const out = buildHighFiveSuggestions([
      mk({ student_id: 'a', had_recent_reteach_win: true }),
      mk({ student_id: 'b', band: 'advanced' }),
    ]);
    const reasons = out.map((s) => s.reason);
    expect(reasons).toContain('reteach_completed');
    expect(reasons).toContain('stretch');
    for (const s of out) { expect(hasLeak(s.context_hint)).toBe(false); expect(hasBannedWord(s.context_hint)).toBe(false); }
  });
  it('skips students who recently got a high-five', () => {
    const out = buildHighFiveSuggestions([mk({ student_id: 'a', band: 'advanced', recent_high_five: true })]);
    expect(out).toHaveLength(0);
  });
  it('respects the limit and prioritises stronger reasons first', () => {
    const out = buildHighFiveSuggestions([
      mk({ student_id: 'a', dominant_effort: 'struggling_trying' }),       // persistence (high)
      mk({ student_id: 'b', band: 'advanced' }),                            // stretch (low)
    ], 1);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('persistence');
  });
});
