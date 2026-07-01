import { describe, it, expect } from 'vitest';
import { normalizeTrend, deriveStrengths } from '@/lib/parent/loadParentProgress';

describe('normalizeTrend', () => {
  it('maps raw grades to 0-1 and forces an empty digit-free label', () => {
    const out = normalizeTrend([
      { date: 'a', grade: 60 },
      { date: 'b', grade: 80 },
      { date: 'c', grade: 100 },
    ]);
    expect(out.map((p) => p.grade)).toEqual([0, 0.5, 1]);
    expect(out.every((p) => p.label === '')).toBe(true);
    expect(out.map((p) => p.date)).toEqual(['a', 'b', 'c']);
  });
  it('never puts a raw grade on a point (defensive scan)', () => {
    const out = normalizeTrend([{ date: 'a', grade: 73 }, { date: 'b', grade: 91 }]);
    for (const p of out) expect(p.grade).toBeLessThanOrEqual(1);
  });
  it('handles a flat series without dividing by zero', () => {
    const out = normalizeTrend([{ date: 'a', grade: 70 }, { date: 'b', grade: 70 }]);
    expect(out.every((p) => Number.isFinite(p.grade))).toBe(true);
  });
  it('passes an empty array through', () => {
    expect(normalizeTrend([])).toEqual([]);
  });
});

describe('deriveStrengths', () => {
  it('keeps only Solid/Excelling skills, capped at 3, order preserved', () => {
    const out = deriveStrengths([
      { skillName: 'Fractions', label: 'Excelling' },
      { skillName: 'Grit', label: 'Building strength' },
      { skillName: 'Poetry', label: 'Solid' },
      { skillName: 'Algebra', label: 'Excelling' },
      { skillName: 'Geometry', label: 'Solid' },
    ]);
    expect(out).toEqual([
      { skillName: 'Fractions', label: 'Excelling' },
      { skillName: 'Poetry', label: 'Solid' },
      { skillName: 'Algebra', label: 'Excelling' },
    ]);
  });
  it('returns [] when nothing qualifies', () => {
    expect(deriveStrengths([{ skillName: 'X', label: 'Building strength' }])).toEqual([]);
  });
});
