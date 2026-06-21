import { describe, it, expect } from 'vitest';
import { coachObservation } from '../coachObservation';
import { assertNoLeak, assertNoBannedWord } from '../leakGuard';
import type { ComputedSignals } from '@/lib/signals/behavioralTypes';

// A neutral, clean baseline model — all thresholds in the calm zone.
function baseModel(over: Partial<ComputedSignals> = {}): ComputedSignals {
  return {
    learningVelocity: 1, velocityTrend: 'stable',
    frustrationScore: 0.1, frustrationIndicators: [],
    attentionScore: 0.9, attentionGaps: 0,
    errorPatternType: 'procedural', errorFrequency: 0.2,
    confidenceScore: 0.6, confidenceAccuracy: 0.6,
    engagementScore: 0.8, engagementStyle: 'methodical',
    predictiveRiskScore: 0.1, riskFactors: [],
    sessionDurationMs: 600000,
    ...over,
  };
}
const lowRisk = { risk_level: 'low', risk_factors: [] as string[] };

describe('coachObservation', () => {
  it('quiet cold-start: no model', () => {
    const o = coachObservation({ computed: null, observationCount: 0, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('quiet');
  });

  it('quiet cold-start: fewer than 2 observations even with a hot model', () => {
    const o = coachObservation({ computed: baseModel({ frustrationScore: 0.9 }), observationCount: 1, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('quiet');
  });

  it('quiet cold-start: insufficient_data error pattern', () => {
    const o = coachObservation({ computed: baseModel({ errorPatternType: 'insufficient_data' }), observationCount: 5, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('quiet');
  });

  it('watch: high frustration wins first', () => {
    const o = coachObservation({ computed: baseModel({ frustrationScore: 0.7, attentionScore: 0.2 }), observationCount: 3, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('watch');
    expect(o.line).toContain('Maya');
    expect(o.suggestion).toBeTruthy();
  });

  it('watch: low attention when frustration is calm', () => {
    const o = coachObservation({ computed: baseModel({ attentionScore: 0.3 }), observationCount: 3, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('watch');
  });

  it('falls back to score-based concern when the model is calm but roster risk is not low', () => {
    const o = coachObservation({ computed: baseModel(), observationCount: 3, firstName: 'Maya', rosterRisk: { risk_level: 'high', risk_factors: ['x'] } });
    expect(o.state).toBe('watch');
  });

  it('calm when model and roster risk are both clean', () => {
    const o = coachObservation({ computed: baseModel(), observationCount: 3, firstName: 'Maya', rosterRisk: lowRisk });
    expect(o.state).toBe('calm');
    expect(o.suggestion).toBeNull();
  });

  it('handles a null firstName without breaking grammar', () => {
    const o = coachObservation({ computed: baseModel({ frustrationScore: 0.8 }), observationCount: 3, firstName: null, rosterRisk: lowRisk });
    expect(o.line.length).toBeGreaterThan(0);
  });

  it('EVERY output passes assertNoLeak AND assertNoBannedWord (non-vacuous)', () => {
    const models: ComputedSignals[] = [
      baseModel({ frustrationScore: 0.8 }),
      baseModel({ attentionScore: 0.2 }),
      baseModel({ engagementStyle: 'passive', engagementScore: 0.2 }),
      baseModel({ engagementStyle: 'impulsive' }),
      baseModel({ errorPatternType: 'careless' }),
      baseModel({ predictiveRiskScore: 0.8 }),
      baseModel(),
      baseModel({ errorPatternType: 'insufficient_data' }),
    ];
    for (const m of models) {
      for (const oc of [0, 1, 3]) {
        for (const fn of ['Maya', null]) {
          for (const rl of ['low', 'high']) {
            const o = coachObservation({ computed: m, observationCount: oc, firstName: fn, rosterRisk: { risk_level: rl, risk_factors: ['a'] } });
            [o.eyebrow, o.line, o.suggestion ?? ''].forEach((s) => {
              expect(() => assertNoLeak(s)).not.toThrow();
              expect(() => assertNoBannedWord(s)).not.toThrow();
            });
          }
        }
      }
    }
  });
});
