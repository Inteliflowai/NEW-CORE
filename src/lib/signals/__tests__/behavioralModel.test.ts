import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComputedSignals } from '../behavioralTypes';

// ---------------------------------------------------------------------------
// Minimal ComputedSignals fixtures
// ---------------------------------------------------------------------------
const makeSignals = (overrides: Partial<ComputedSignals> = {}): ComputedSignals => ({
  learningVelocity: 1,
  velocityTrend: 'stable',
  frustrationScore: 0.1,
  frustrationIndicators: [],
  attentionScore: 0.9,
  attentionGaps: 0,
  errorPatternType: 'random',
  errorFrequency: 0.1,
  confidenceScore: 0.8,
  confidenceAccuracy: 0.7,
  engagementScore: 0.8,
  engagementStyle: 'methodical',
  predictiveRiskScore: 0.2,
  riskFactors: [],
  sessionDurationMs: 60000,
  ...overrides,
});

// ---------------------------------------------------------------------------
// emaMerge — import after mocks so the module is unambiguous
// ---------------------------------------------------------------------------
import { emaMerge, upsertBehavioralSignals } from '../behavioralModel';

describe('emaMerge', () => {
  it('returns next deep-equal when prev is null', () => {
    const next = makeSignals({ learningVelocity: 3 });
    const result = emaMerge(null, next);
    expect(result).toEqual(next);
  });

  it('blends numeric fields: 0.4*next + 0.6*prev', () => {
    const prev = makeSignals({ learningVelocity: 2, frustrationScore: 0.2, attentionScore: 0.5 });
    const next = makeSignals({ learningVelocity: 4, frustrationScore: 0.6, attentionScore: 1.0 });
    const result = emaMerge(prev, next, 0.4);

    // learningVelocity: 0.4*4 + 0.6*2 = 1.6 + 1.2 = 2.8
    expect(result.learningVelocity).toBeCloseTo(2.8, 10);
    // frustrationScore: 0.4*0.6 + 0.6*0.2 = 0.24 + 0.12 = 0.36
    expect(result.frustrationScore).toBeCloseTo(0.36, 10);
    // attentionScore: 0.4*1.0 + 0.6*0.5 = 0.4 + 0.3 = 0.7
    expect(result.attentionScore).toBeCloseTo(0.7, 10);
  });

  it('blends remaining numeric fields correctly', () => {
    const prev = makeSignals({
      attentionGaps: 2,
      errorFrequency: 0.4,
      confidenceScore: 0.6,
      confidenceAccuracy: 0.5,
      engagementScore: 0.3,
      predictiveRiskScore: 0.8,
      sessionDurationMs: 40000,
    });
    const next = makeSignals({
      attentionGaps: 4,
      errorFrequency: 0.2,
      confidenceScore: 1.0,
      confidenceAccuracy: 0.9,
      engagementScore: 0.7,
      predictiveRiskScore: 0.4,
      sessionDurationMs: 80000,
    });
    const result = emaMerge(prev, next, 0.4);

    // attentionGaps: 0.4*4 + 0.6*2 = 1.6 + 1.2 = 2.8
    expect(result.attentionGaps).toBeCloseTo(2.8, 10);
    // errorFrequency: 0.4*0.2 + 0.6*0.4 = 0.08 + 0.24 = 0.32
    expect(result.errorFrequency).toBeCloseTo(0.32, 10);
    // confidenceScore: 0.4*1.0 + 0.6*0.6 = 0.4 + 0.36 = 0.76
    expect(result.confidenceScore).toBeCloseTo(0.76, 10);
    // confidenceAccuracy: 0.4*0.9 + 0.6*0.5 = 0.36 + 0.30 = 0.66
    expect(result.confidenceAccuracy).toBeCloseTo(0.66, 10);
    // engagementScore: 0.4*0.7 + 0.6*0.3 = 0.28 + 0.18 = 0.46
    expect(result.engagementScore).toBeCloseTo(0.46, 10);
    // predictiveRiskScore: 0.4*0.4 + 0.6*0.8 = 0.16 + 0.48 = 0.64
    expect(result.predictiveRiskScore).toBeCloseTo(0.64, 10);
    // sessionDurationMs: 0.4*80000 + 0.6*40000 = 32000 + 24000 = 56000
    expect(result.sessionDurationMs).toBeCloseTo(56000, 10);
  });

  it('categorical fields take next (not blended)', () => {
    const prev = makeSignals({
      velocityTrend: 'stable',
      errorPatternType: 'careless',
      engagementStyle: 'methodical',
    });
    const next = makeSignals({
      velocityTrend: 'accelerating',
      errorPatternType: 'conceptual',
      engagementStyle: 'exploratory',
    });
    const result = emaMerge(prev, next);
    expect(result.velocityTrend).toBe('accelerating');
    expect(result.errorPatternType).toBe('conceptual');
    expect(result.engagementStyle).toBe('exploratory');
  });

  it('array fields take next (not merged)', () => {
    const prev = makeSignals({
      frustrationIndicators: ['high_pause_rate', 'stuckErase'],
      riskFactors: ['low_attention'],
    });
    const next = makeSignals({
      frustrationIndicators: ['low_speed'],
      riskFactors: ['high_frustration', 'low_engagement'],
    });
    const result = emaMerge(prev, next);
    expect(result.frustrationIndicators).toEqual(['low_speed']);
    expect(result.riskFactors).toEqual(['high_frustration', 'low_engagement']);
  });

  it('respects a custom alpha value', () => {
    const prev = makeSignals({ learningVelocity: 10 });
    const next = makeSignals({ learningVelocity: 0 });
    // alpha=1.0 → result = 1.0*0 + 0.0*10 = 0
    expect(emaMerge(prev, next, 1.0).learningVelocity).toBeCloseTo(0, 10);
    // alpha=0.0 → result = 0*0 + 1.0*10 = 10
    expect(emaMerge(prev, next, 0.0).learningVelocity).toBeCloseTo(10, 10);
  });
});

// ---------------------------------------------------------------------------
// upsertBehavioralSignals — mock the admin client chain
// ---------------------------------------------------------------------------

// Stub functions shared across tests; reset in beforeEach
const maybySingle = vi.fn();
const eqFn = vi.fn();
const selectFn = vi.fn();
const upsertFn = vi.fn();
const fromFn = vi.fn();

const mockAdmin = { from: fromFn } as unknown as ReturnType<
  typeof import('@/lib/supabase/server').createAdminSupabaseClient
>;

describe('upsertBehavioralSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default chain: from → select → eq → maybySingle
    fromFn.mockReturnValue({ select: selectFn, upsert: upsertFn });
    selectFn.mockReturnValue({ eq: eqFn });
    eqFn.mockReturnValue({ maybeSingle: maybySingle });
    upsertFn.mockResolvedValue({ error: null });
  });

  it('upserts merged computed + increments observation_count when a prev row exists', async () => {
    const prevSignals = makeSignals({ learningVelocity: 2 });
    const nextSignals = makeSignals({ learningVelocity: 4 });
    const prevRow = { computed: prevSignals, observation_count: 5 };
    maybySingle.mockResolvedValue({ data: prevRow, error: null });

    await upsertBehavioralSignals(mockAdmin, {
      studentId: 'stu-1',
      schoolId: 'sch-1',
      next: nextSignals,
    });

    const expectedComputed = emaMerge(prevSignals, nextSignals);

    expect(upsertFn).toHaveBeenCalledTimes(1);
    const [payload, options] = upsertFn.mock.calls[0];
    expect(payload.student_id).toBe('stu-1');
    expect(payload.school_id).toBe('sch-1');
    expect(payload.observation_count).toBe(6);
    expect(payload.computed).toEqual(expectedComputed);
    expect(typeof payload.updated_at).toBe('string'); // ISO string
    expect(options).toEqual({ onConflict: 'student_id' });
  });

  it('upserts next directly + observation_count=1 when no prev row exists', async () => {
    const nextSignals = makeSignals({ learningVelocity: 3 });
    maybySingle.mockResolvedValue({ data: null, error: null });

    await upsertBehavioralSignals(mockAdmin, {
      studentId: 'stu-2',
      schoolId: null,
      next: nextSignals,
    });

    expect(upsertFn).toHaveBeenCalledTimes(1);
    const [payload, options] = upsertFn.mock.calls[0];
    expect(payload.student_id).toBe('stu-2');
    expect(payload.school_id).toBeNull();
    expect(payload.observation_count).toBe(1);
    expect(payload.computed).toEqual(nextSignals);
    expect(options).toEqual({ onConflict: 'student_id' });
  });

  it('queries behavioral_signals with the correct student_id', async () => {
    maybySingle.mockResolvedValue({ data: null, error: null });
    await upsertBehavioralSignals(mockAdmin, {
      studentId: 'stu-3',
      schoolId: 'sch-99',
      next: makeSignals(),
    });
    expect(fromFn).toHaveBeenCalledWith('behavioral_signals');
    expect(selectFn).toHaveBeenCalledWith('computed, observation_count');
    expect(eqFn).toHaveBeenCalledWith('student_id', 'stu-3');
  });
});
