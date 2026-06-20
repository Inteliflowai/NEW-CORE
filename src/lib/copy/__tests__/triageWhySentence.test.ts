import { describe, it, expect } from 'vitest';
import { triageWhySentence } from '../triageWhySentence';

describe('triageWhySentence', () => {
  it('reteach: keeps quiz % + the gap, explains the split, no "HW"', () => {
    const s = triageWhySentence({ suggestedAction: 'reteach', divergence_score: 44, hw_avg: 80, quiz_avg: 36 });
    expect(s).toContain('36%');
    expect(s).toContain('44 points');
    expect(s.toLowerCase()).toContain('assignment');
    expect(s).not.toMatch(/\bHW\b/);
    expect(s.toLowerCase()).not.toContain('homework');
  });

  it('verbal_check: keeps both averages + says "Assignment", not "HW"', () => {
    const s = triageWhySentence({ suggestedAction: 'verbal_check', divergence_score: 25, hw_avg: 41, quiz_avg: 66 });
    expect(s).toContain('41%');
    expect(s).toContain('66%');
    expect(s).toContain('Assignment average');
    expect(s).not.toMatch(/\bHW\b/);
  });

  it('profile: explains divergence as the assignment-vs-quiz gap, keeps the number', () => {
    const s = triageWhySentence({ suggestedAction: 'profile', divergence_score: 55, hw_avg: 70, quiz_avg: 25 });
    expect(s).toMatch(/diverge|gap/i);
    expect(s).toContain('55 points');
  });

  it('monitor: shows the gap + names it a small divergence', () => {
    const s = triageWhySentence({ suggestedAction: 'monitor', divergence_score: 22, hw_avg: 60, quiz_avg: 82 });
    expect(s).toContain('22-point');
    expect(s.toLowerCase()).toContain('divergence');
  });

  it('never says "HW" or "Homework" for any action', () => {
    for (const a of ['reteach', 'verbal_check', 'practice', 'profile', 'monitor'] as const) {
      const s = triageWhySentence({ suggestedAction: a, divergence_score: 30, hw_avg: 50, quiz_avg: 70 });
      expect(s, a).not.toMatch(/\bHW\b/);
      expect(s.toLowerCase(), a).not.toContain('homework');
    }
  });

  it('null averages: falls back without crashing or printing "null"', () => {
    const s = triageWhySentence({ suggestedAction: 'reteach', divergence_score: 40, hw_avg: null, quiz_avg: null });
    expect(s).not.toContain('null');
    expect(s.length).toBeGreaterThan(0);
  });
});
