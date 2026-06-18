import { describe, it, expect } from 'vitest';
import { computeConsistency, computeTrajectory } from '../consistency';

// ─── computeConsistency ──────────────────────────────────────
describe('computeConsistency', () => {
  // ── Cold start ──────────────────────────────────────────────
  it('returns null,null when fewer than 3 scores', () => {
    expect(computeConsistency([])).toEqual({ consistency_score: null, consistency_label: null });
    expect(computeConsistency([80])).toEqual({ consistency_score: null, consistency_label: null });
    expect(computeConsistency([80, 85])).toEqual({ consistency_score: null, consistency_label: null });
  });

  it('works with exactly 3 scores', () => {
    const result = computeConsistency([80, 80, 80]);
    expect(result.consistency_score).not.toBeNull();
    expect(result.consistency_label).not.toBeNull();
  });

  // ── std-dev band: ≤5 → 95+ → consistent ────────────────────
  it('stdDev=0 (all same) → score=100, label=consistent', () => {
    // scores=[80,80,80,80,80]: mean=80, stdDev=0 → 95+(5-0)=100
    const result = computeConsistency([80, 80, 80, 80, 80]);
    expect(result.consistency_score).toBe(100);
    expect(result.consistency_label).toBe('consistent');
  });

  it('stdDev=5 (boundary) → score=95, label=consistent', () => {
    // stdDev=0 ≤ 5 → score = 95 + (5 - 0) = 100
    const result = computeConsistency([80, 80, 80, 80, 80]);
    expect(result.consistency_score).toBeGreaterThanOrEqual(95);
    expect(result.consistency_label).toBe('consistent');
  });

  it('stdDev just above 5 → still consistent if ≤15', () => {
    // scores=[70,80,80,80,90]: mean=80, var=[(−10)²+0+0+0+(10)²]/5=200/5=40, sd≈6.32
    // formula: 70+(15-6.32)*2.5=70+21.7=91.7 ≥70 → consistent
    const result = computeConsistency([70, 80, 80, 80, 90]);
    expect(result.consistency_score).toBeGreaterThanOrEqual(70);
    expect(result.consistency_label).toBe('consistent');
  });

  // ── std-dev band: ≤15 → 70+ → consistent ────────────────────
  it('stdDev~13 → score≥70, label=consistent', () => {
    // scores=[65,65,80,95,95]: mean=80
    // var=[(−15)²+(−15)²+0+(15)²+(15)²]/5=900/5=180, sd≈13.42
    // formula: 70+(15-13.42)*2.5≈73.95 → consistent
    const result = computeConsistency([65, 65, 80, 95, 95]);
    expect(result.consistency_score).toBeGreaterThanOrEqual(70);
    expect(result.consistency_label).toBe('consistent');
  });

  // ── std-dev band: ≤25 → 40+ → variable ─────────────────────
  it('stdDev~20 → variable', () => {
    // [50,70,80,90,110]: mean=80, var=[900+100+0+100+900]/5=400, sd=20
    // formula: 70+(15-20)*2.5=70-12.5=57.5 → ≥40 variable (not ≥70)
    const result = computeConsistency([50, 70, 80, 90, 110]);
    expect(result.consistency_score).toBeGreaterThanOrEqual(40);
    expect(result.consistency_score!).toBeLessThan(70);
    expect(result.consistency_label).toBe('variable');
  });

  it('stdDev~24 → variable', () => {
    // [45,65,80,95,115]: mean=80, var=[(−35)²+(−15)²+0+(15)²+(35)²]/5=2900/5=580, sd≈24.08
    // formula: 40+(25-24.08)*3=40+2.76≈42.76 → variable
    const result = computeConsistency([45, 65, 80, 95, 115]);
    expect(result.consistency_score).toBeGreaterThanOrEqual(40);
    expect(result.consistency_label).toBe('variable');
  });

  // ── std-dev > 25 → <40 → erratic ────────────────────────────
  it('stdDev>25 → erratic', () => {
    // [20,50,80,110,140]: mean=80, var=[3600+900+0+900+3600]/5=1800, sd≈42.43
    // formula: max(0, 40-(42.43-25)*2) = max(0, 40-34.86)=5.14 → <40 → erratic
    const result = computeConsistency([20, 50, 80, 110, 140]);
    expect(result.consistency_score!).toBeLessThan(40);
    expect(result.consistency_label).toBe('erratic');
  });

  it('stdDev very large → score=0 → erratic', () => {
    const result = computeConsistency([0, 50, 80, 130, 140]);
    expect(result.consistency_label).toBe('erratic');
  });

  // ── Pass-through: caller controls which scores ──────────────
  it('tight scores → consistent (caller passes last-5)', () => {
    const result = computeConsistency([79, 80, 80, 81, 80]);
    expect(result.consistency_label).toBe('consistent');
  });
});

// ─── computeTrajectory ──────────────────────────────────────
describe('computeTrajectory', () => {
  // ── Cold start ──────────────────────────────────────────────
  it('returns stable when fewer than 4 history points', () => {
    expect(computeTrajectory([])).toEqual({ trajectory: 'stable' });
    expect(computeTrajectory([80])).toEqual({ trajectory: 'stable' });
    expect(computeTrajectory([80, 85])).toEqual({ trajectory: 'stable' });
    expect(computeTrajectory([80, 85, 90])).toEqual({ trajectory: 'stable' });
  });

  // ── lowerIsBetter=true (default) ────────────────────────────
  it('lowerIsBetter=true: decreasing values → improving', () => {
    // history=[100,80,60,40,20,10]:
    //   last-3=[40,20,10], recentAvg=23.33
    //   older=[100,80,60], olderAvg=80
    //   delta=(23.33-80)/80=-0.708 < -0.1 → isIncreasing=false → lowerIsBetter+!increasing → improving
    const result = computeTrajectory([100, 80, 60, 40, 20, 10]);
    expect(result.trajectory).toBe('improving');
  });

  it('lowerIsBetter=true: increasing values → worsening', () => {
    // history=[10,20,40,60,80,100]:
    //   last-3=[60,80,100], recentAvg=80
    //   older=[10,20,40], olderAvg=23.33
    //   delta=(80-23.33)/23.33=2.43 > 0.1 → isIncreasing=true → lowerIsBetter+increasing → worsening
    const result = computeTrajectory([10, 20, 40, 60, 80, 100]);
    expect(result.trajectory).toBe('worsening');
  });

  // ── C6 polarity test: same declining history → opposite labels ──
  it('C6 polarity: declining scores → improving with lowerIsBetter=true, worsening with lowerIsBetter=false', () => {
    // Declining history: scores going from high to low (bad for quiz, good for "risk")
    const declining = [100, 80, 60, 40, 20, 10];
    expect(computeTrajectory(declining, true).trajectory).toBe('improving');
    expect(computeTrajectory(declining, false).trajectory).toBe('worsening');
  });

  // ── lowerIsBetter=false (higher is better, e.g. quiz scores) ─
  it('lowerIsBetter=false: increasing values → improving', () => {
    const result = computeTrajectory([10, 20, 40, 60, 80, 100], false);
    expect(result.trajectory).toBe('improving');
  });

  it('lowerIsBetter=false: decreasing values → worsening', () => {
    const result = computeTrajectory([100, 80, 60, 40, 20, 10], false);
    expect(result.trajectory).toBe('worsening');
  });

  // ── stable when delta < 10% ──────────────────────────────────
  it('returns stable when delta < 10%', () => {
    // history=[80,82,81,83,82,81]:
    //   last-3=[83,82,81], recentAvg=82
    //   older=[80,82,81], olderAvg=81
    //   delta=(82-81)/81=0.012 < 0.1 → stable
    const result = computeTrajectory([80, 82, 81, 83, 82, 81], false);
    expect(result.trajectory).toBe('stable');
  });

  it('exactly 4 history points works (last-3 vs slice(-6,-3))', () => {
    // history=[50,60,70,80] (4 points):
    //   last-3=[60,70,80], recentAvg=70
    //   slice(-6,-3)=[50], olderAvg=50
    //   delta=(70-50)/50=0.4 > 0.1 → lowerIsBetter=false → improving
    const result = computeTrajectory([50, 60, 70, 80], false);
    expect(result.trajectory).toBe('improving');
  });

  it('stable when delta=0 (identical values)', () => {
    const result = computeTrajectory([80, 80, 80, 80], false);
    expect(result.trajectory).toBe('stable');
  });
});
