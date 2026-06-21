// src/app/api/attempts/[attemptId]/__tests__/submit-signals.test.ts
// Task 7: behavioral-signal store hook on the submit route.
//
// Assertions:
//   (a) On the all-clean submit path, upsertBehavioralSignals is called exactly
//       once with { studentId, schoolId } populated and a `next` that is the
//       ComputedSignals returned by the mocked computeSignals.
//   (b) When the hook throws (computeSignals throws), the route STILL returns
//       its normal success response — fail-isolation is proven.
//   (c) When upsertBehavioralSignals throws, the route STILL returns 200 — fail-isolated.
//   (d) Hook does NOT fire on pending/failed path.
//
// Mocking pattern mirrors the existing submit route test (route.test.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { ComputedSignals } from '@/lib/signals/behavioralTypes';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(attemptId = 'attempt-1'): NextRequest {
  return new NextRequest(`http://localhost/api/attempts/${attemptId}/submit`, {
    method: 'POST',
  });
}

const VALID_GRADE = {
  score: 1.0 as const,
  explanation: 'complete answer',
  confidence: 0.9,
  grader_source: 'ai',
  error_type: 'none' as const,
  reasoning_pattern: 'full_reasoning' as const,
  misinterpretation_detected: false,
  vocabulary_difficulty: 'low' as const,
  cognitive_notes: 'Strong reasoning demonstrated.',
};

// Fake attempt with session timing + session_aggregates
const FAKE_ATTEMPT = {
  id: 'attempt-1',
  student_id: 'student-1',
  is_complete: false,
  adapted_questions: null,
  started_at: '2026-06-20T10:00:00.000Z',
  submitted_at: '2026-06-20T10:15:00.000Z',
  session_aggregates: {
    focusLossCount: 1,
    pasteCount: 0,
    pauseCount: 2,
    totalPauseMs: 3000,
    totalFocusLossMs: 500,
    backspaceCount: 5,
    keypressCount: 100,
    ttsPlayCount: 0,
    canvasUsed: false,
    stuckEraseCount: 0,
  },
  quizzes: {
    quiz_questions: [
      { position: 1, question_type: 'mcq', question_text: 'MCQ1', choices: [], correct_answer: 'A', rubric: null, numeric_spec: null },
      { position: 2, question_type: 'mcq', question_text: 'MCQ2', choices: [], correct_answer: 'B', rubric: null, numeric_spec: null },
      { position: 3, question_type: 'numeric', question_text: 'Num1', choices: null, correct_answer: null, rubric: null, numeric_spec: { accepted: ['42'], tolerance: 0 } },
      { position: 4, question_type: 'open', question_text: 'OEQ1', rubric: 'Rubric4', choices: null, correct_answer: null, numeric_spec: null },
      { position: 5, question_type: 'open', question_text: 'OEQ2', rubric: 'Rubric5', choices: null, correct_answer: null, numeric_spec: null },
    ],
  },
};

// Fake responses — include behavioral telemetry fields for the signals hook
const FAKE_RESPONSES = [
  { position: 1, question_id: 'q-id-1', response_text: 'A', is_correct: null, response_time_ms: 5000, answer_changes: 0, hints_used: 0 },
  { position: 2, question_id: 'q-id-2', response_text: 'B', is_correct: null, response_time_ms: 6000, answer_changes: 1, hints_used: 0 },
  { position: 3, question_id: 'q-id-3', response_text: '42', is_correct: null, response_time_ms: 8000, answer_changes: 0, hints_used: 0 },
  { position: 4, question_id: 'q-id-4', response_text: 'Student answer 4', response_time_ms: 30000, answer_changes: 2, hints_used: 1 },
  { position: 5, question_id: 'q-id-5', response_text: 'Student answer 5', response_time_ms: 25000, answer_changes: 0, hints_used: 0 },
];

// The ComputedSignals value the mock computeSignals will return
const FAKE_COMPUTED_SIGNALS: ComputedSignals = {
  learningVelocity: 0.5,
  velocityTrend: 'stable',
  frustrationScore: 0.1,
  frustrationIndicators: [],
  attentionScore: 0.9,
  attentionGaps: 1,
  errorPatternType: 'random',
  errorFrequency: 0,
  confidenceScore: 0.7,
  confidenceAccuracy: 0.6,
  engagementScore: 0.8,
  engagementStyle: 'methodical',
  predictiveRiskScore: 0.15,
  riskFactors: [],
  sessionDurationMs: 900000,
};

// Chain builder (same pattern as route.test.ts)
function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain['select'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['in'] = vi.fn().mockReturnValue(chain);
  chain['gte'] = vi.fn().mockReturnValue(chain);
  chain['lte'] = vi.fn().mockReturnValue(chain);
  chain['update'] = vi.fn().mockReturnValue(chain);
  chain['upsert'] = vi.fn().mockReturnValue(chain);
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null });
  chain['single'] = vi.fn().mockResolvedValue({ data, error });
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return chain;
}

function makeAdminMock(opts: {
  attempt?: unknown;
  responses?: unknown;
  mcqUpdateError?: unknown;
  responseUpdateError?: unknown;
  finalUpdateError?: unknown;
  usersSchoolId?: string | null;
} = {}) {
  const {
    attempt = FAKE_ATTEMPT,
    responses = FAKE_RESPONSES,
    mcqUpdateError = null,
    responseUpdateError = null,
    finalUpdateError = null,
    usersSchoolId = 'school-xyz',
  } = opts;

  const attemptChain = makeChain(attempt);

  const responsesChain = makeChain(responses);

  const mcqUpdateChain: Record<string, unknown> = {};
  mcqUpdateChain['eq'] = vi.fn().mockReturnValue(mcqUpdateChain);
  mcqUpdateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: mcqUpdateError }).then(resolve);

  const oeqUpdateChain: Record<string, unknown> = {};
  oeqUpdateChain['eq'] = vi.fn().mockReturnValue(oeqUpdateChain);
  oeqUpdateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: responseUpdateError }).then(resolve);

  const attemptsUpdateChain: Record<string, unknown> = {};
  attemptsUpdateChain['eq'] = vi.fn().mockReturnValue(attemptsUpdateChain);
  attemptsUpdateChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: finalUpdateError }).then(resolve);

  const usersChain = makeChain(usersSchoolId != null ? { school_id: usersSchoolId } : null);

  // behavioral_signals chain for upsertBehavioralSignals (maybeSingle returns null = no prior row)
  const behavioralChain: Record<string, unknown> = {};
  behavioralChain['select'] = vi.fn().mockReturnValue(behavioralChain);
  behavioralChain['eq'] = vi.fn().mockReturnValue(behavioralChain);
  behavioralChain['upsert'] = vi.fn().mockResolvedValue({ data: null, error: null });
  behavioralChain['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null });
  behavioralChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve);

  return {
    from: vi.fn((table: string) => {
      if (table === 'quiz_attempts') {
        const chain = { ...attemptChain };
        chain['update'] = vi.fn().mockReturnValue(attemptsUpdateChain);
        return chain;
      }
      if (table === 'quiz_responses') {
        const chain = { ...responsesChain };
        chain['update'] = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          if ('is_correct' in payload) return mcqUpdateChain;
          return oeqUpdateChain;
        });
        return chain;
      }
      if (table === 'users') {
        return usersChain;
      }
      if (table === 'behavioral_signals') {
        return behavioralChain;
      }
      return makeChain(null);
    }),
  };
}

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const mockGradeOpenResponse = vi.fn();
vi.mock('@/lib/engine/grading', () => ({
  gradeOpenResponse: (...a: unknown[]) => mockGradeOpenResponse(...a),
}));

const mockRecomputeSkillStates = vi.fn();
vi.mock('@/lib/skills/recomputeSkillStates', () => ({
  recomputeSkillStatesForStudent: (...a: unknown[]) => mockRecomputeSkillStates(...a),
}));

const mockRecordMisconceptions = vi.fn();
vi.mock('@/lib/misconceptions/recordMisconceptions', () => ({
  recordMisconceptions: (...a: unknown[]) => mockRecordMisconceptions(...a),
}));

const mockComputeSignals = vi.fn();
vi.mock('@/lib/signals/computeSignals', () => ({
  computeSignals: (...a: unknown[]) => mockComputeSignals(...a),
}));

const mockUpsertBehavioralSignals = vi.fn();
vi.mock('@/lib/signals/behavioralModel', () => ({
  upsertBehavioralSignals: (...a: unknown[]) => mockUpsertBehavioralSignals(...a),
  emaMerge: vi.fn(),
}));

// ─── tests ────────────────────────────────────────────────────────────────────

describe('submit route — behavioral signal hook (Task 7)', () => {
  beforeEach(() => {
    mockGradeOpenResponse.mockReset();
    mockRecomputeSkillStates.mockReset();
    mockRecordMisconceptions.mockReset();
    mockComputeSignals.mockReset();
    mockUpsertBehavioralSignals.mockReset();

    // Default happy-path mocks
    mockGradeOpenResponse.mockResolvedValue(VALID_GRADE);
    mockRecomputeSkillStates.mockResolvedValue({ ok: true, skillsRecomputed: 1, states: {} });
    mockRecordMisconceptions.mockResolvedValue({ written: 0 });
    mockComputeSignals.mockReturnValue(FAKE_COMPUTED_SIGNALS);
    mockUpsertBehavioralSignals.mockResolvedValue(undefined);

    vi.resetModules();
  });

  // ── (a) Happy path: upsertBehavioralSignals called once with correct args ──
  it('all-clean submit: calls upsertBehavioralSignals once with studentId, schoolId, and ComputedSignals from computeSignals', async () => {
    const adminMock = makeAdminMock({ usersSchoolId: 'school-xyz' });

    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grading_delayed).toBeFalsy();
    expect(body.grades).toBeDefined();

    // Wait for fire-and-forget hook to settle
    await vi.waitFor(() => {
      expect(mockUpsertBehavioralSignals).toHaveBeenCalled();
    });

    expect(mockUpsertBehavioralSignals).toHaveBeenCalledTimes(1);
    expect(mockUpsertBehavioralSignals).toHaveBeenCalledWith(
      expect.anything(), // admin client
      expect.objectContaining({
        studentId: 'student-1',
        schoolId: 'school-xyz',
        next: FAKE_COMPUTED_SIGNALS,
      }),
    );
  });

  // ── (a) computeSignals receives properly-shaped RawSessionData ─────────────
  it('all-clean submit: computeSignals is called with RawSessionData built from quiz_responses + session_aggregates', async () => {
    const adminMock = makeAdminMock({ usersSchoolId: 'school-xyz' });

    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    expect(res.status).toBe(200);

    // Wait for the full IIFE to complete (computeSignals + upsertBehavioralSignals)
    await vi.waitFor(() => {
      expect(mockUpsertBehavioralSignals).toHaveBeenCalled();
    });

    const callArg = mockComputeSignals.mock.calls[0][0] as {
      studentId: string;
      sessionId: string;
      context: string;
      schoolId: string | null;
      questionAttempts: Array<{ questionId: string; questionIndex: number; isCorrect: boolean; timeTakenMs: number; changeCount: number; hintsUsed: number }>;
      aggregates: Record<string, unknown>;
      sessionStartMs: number;
      sessionEndMs: number;
    };

    // studentId, context, schoolId
    expect(callArg.studentId).toBe('student-1');
    expect(callArg.context).toBe('quiz');

    // QuestionAttemptData[] — 5 responses mapped
    expect(callArg.questionAttempts).toHaveLength(5);
    // Check field mapping for position 4 (OEQ, answer_changes=2, hints_used=1)
    const q4 = callArg.questionAttempts.find(q => q.questionIndex === 4);
    expect(q4).toBeDefined();
    expect(q4!.isCorrect).toBe(true);   // OEQ graded score=1 → isCorrect true
    expect(q4!.timeTakenMs).toBe(30000);
    expect(q4!.changeCount).toBe(2);
    expect(q4!.hintsUsed).toBe(1);

    // SessionAggregates from session_aggregates jsonb
    expect(callArg.aggregates).toMatchObject({
      focusLossCount: 1,
      pasteCount: 0,
      pauseCount: 2,
      totalPauseMs: 3000,
      totalFocusLossMs: 500,
      backspaceCount: 5,
      keypressCount: 100,
      ttsPlayCount: 0,
      canvasUsed: false,
      stuckEraseCount: 0,
    });

    // sessionStartMs / sessionEndMs from started_at / submitted_at ISO strings
    expect(callArg.sessionStartMs).toBe(new Date('2026-06-20T10:00:00.000Z').getTime());
    expect(callArg.sessionEndMs).toBe(new Date('2026-06-20T10:15:00.000Z').getTime());
  });

  // ── (b) Fail-isolation: computeSignals throws → route still 200 ────────────
  it('fail-isolation: when computeSignals throws, submit still returns 200 with grades', async () => {
    mockComputeSignals.mockImplementation(() => { throw new Error('compute exploded'); });

    const adminMock = makeAdminMock({ usersSchoolId: 'school-xyz' });
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    // Grade must still be returned — hook failure is non-blocking
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grading_delayed).toBeFalsy();
    expect(body.grades).toBeDefined();
    expect(body.mastery_band).toBeDefined();
  });

  // ── (c) Fail-isolation: upsertBehavioralSignals throws → route still 200 ───
  it('fail-isolation: when upsertBehavioralSignals throws, submit still returns 200 with grades', async () => {
    mockUpsertBehavioralSignals.mockRejectedValue(new Error('upsert exploded'));

    const adminMock = makeAdminMock({ usersSchoolId: 'school-xyz' });
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grading_delayed).toBeFalsy();
    expect(body.grades).toBeDefined();

    // Wait for the hook to attempt and fail
    await vi.waitFor(() => {
      expect(mockUpsertBehavioralSignals).toHaveBeenCalled();
    });
    // Allow the rejected promise + catch block to fully settle before the next test
    await new Promise(r => setTimeout(r, 10));
  });

  // ── (d) Hook does NOT fire on pending/failed path ──────────────────────────
  it('hook does NOT fire when grading fails (pending path)', async () => {
    mockGradeOpenResponse
      .mockResolvedValueOnce(VALID_GRADE)
      .mockRejectedValueOnce(new Error('LLM down'));

    const adminMock = makeAdminMock({ usersSchoolId: 'school-xyz' });
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student-1' } }, error: null }) },
    } as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never);

    const { POST } = await import('@/app/api/attempts/[attemptId]/submit/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ attemptId: 'attempt-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grading_delayed).toBe(true);

    // Allow async hooks from this and prior tests to settle.
    // Use a multi-tick wait that clears both microtasks and I/O callbacks.
    await new Promise(r => setTimeout(r, 20));
    // Capture call counts at this point — both must be 0 (hook fires only on all-clean path)
    expect(mockComputeSignals).not.toHaveBeenCalled();
    expect(mockUpsertBehavioralSignals).not.toHaveBeenCalled();
  });
});
