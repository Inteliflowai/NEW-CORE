// src/lib/quiz/__tests__/forfeitAttempt.test.ts
// TDD: tests written before implementation (node env — no jsdom needed).
// Mocks the injected admin client chain for all DB interactions.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Chain mock stubs — forfeitAttempt calls admin.from(...) multiple times
// with different chains. We model them below.
// ---------------------------------------------------------------------------

// Shared final-step fns reused across chains
const attemptSingle = vi.fn();
const questionOrder = vi.fn();
const responsesEq = vi.fn();
const attemptUpdateEq = vi.fn();
const responseUpdateEq2 = vi.fn();
const responseUpdateEq1 = vi.fn();

// Per-table select/eq/update chains
const attemptSelectFn = vi.fn();
const attemptEqFn = vi.fn();

const questionSelectFn = vi.fn();
const questionEqFn = vi.fn();

const responseSelectFn = vi.fn();

const responseUpdateFn = vi.fn();
const responseUpdateEqAttemptFn = vi.fn();

const attemptUpdateFn = vi.fn();

// The from() fn dispatches to per-table chains
const fromFn = vi.fn();

// Build the mock admin object
const mockAdmin = { from: fromFn } as unknown as Parameters<typeof import('../forfeitAttempt').forfeitAttempt>[0]['admin'];

// ---------------------------------------------------------------------------
// Import the module AFTER mocks are established
// ---------------------------------------------------------------------------
import { forfeitAttempt } from '../forfeitAttempt';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ATTEMPT_ID = 'att-001';
const QUIZ_ID = 'quiz-001';

function makeAttemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    quiz_id: QUIZ_ID,
    last_active_at: '2026-06-20T10:00:00Z',
    is_complete: false,
    ...overrides,
  };
}

function makeQuestions() {
  return [
    { id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'B', numeric_spec: null },
    { id: 'q2', position: 2, question_type: 'mcq', correct_answer: 'A', numeric_spec: null },
    { id: 'q3', position: 3, question_type: 'numeric', correct_answer: '0.5', numeric_spec: { accepted: ['0.5', '1/2'] } },
    { id: 'q4', position: 4, question_type: 'open', correct_answer: null, numeric_spec: null },
    { id: 'q5', position: 5, question_type: 'open', correct_answer: null, numeric_spec: null },
  ];
}

function makeResponses(overrides: Array<Record<string, unknown>> = []) {
  return overrides;
}

// ---------------------------------------------------------------------------
// Helper: wire up the admin mock for a given test scenario
// ---------------------------------------------------------------------------
function wireAdmin({
  attemptData,
  attemptError = null,
  questionData,
  questionError = null,
  responseData,
  responseError = null,
  updateError = null,
}: {
  attemptData: ReturnType<typeof makeAttemptRow> | null;
  attemptError?: { message: string } | null;
  questionData: ReturnType<typeof makeQuestions> | null;
  questionError?: { message: string } | null;
  responseData: Array<Record<string, unknown>> | null;
  responseError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  fromFn.mockImplementation((table: string) => {
    if (table === 'quiz_attempts') {
      return {
        select: (cols: string) => {
          // Distinguish read vs update by the presence of columns arg
          void cols;
          return {
            eq: (col: string, val: unknown) => {
              void col; void val;
              return {
                single: () => Promise.resolve({ data: attemptData, error: attemptError }),
              };
            },
          };
        },
        update: (_payload: unknown) => {
          return {
            eq: (_col: string, _val: unknown) => Promise.resolve({ error: updateError }),
          };
        },
      };
    }

    if (table === 'quiz_questions') {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: unknown) => ({
            order: (_col2: string) => Promise.resolve({ data: questionData, error: questionError }),
          }),
        }),
      };
    }

    if (table === 'quiz_responses') {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: unknown) => Promise.resolve({ data: responseData, error: responseError }),
        }),
        update: (_payload: unknown) => ({
          eq: (_col: string, _val: unknown) => ({
            eq: (_col2: string, _val2: unknown) => Promise.resolve({ error: null }),
          }),
        }),
      };
    }

    throw new Error(`Unexpected from('${table}')`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('forfeitAttempt', () => {

  it('all-correct MCQ answers → scorePct=100 and band=advanced', async () => {
    wireAdmin({
      attemptData: makeAttemptRow(),
      questionData: [
        { id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'B', numeric_spec: null },
        { id: 'q2', position: 2, question_type: 'mcq', correct_answer: 'A', numeric_spec: null },
      ],
      responseData: [
        { question_id: 'q1', position: 1, response_text: 'B' },
        { question_id: 'q2', position: 2, response_text: 'A' },
      ],
    });

    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toEqual({ ok: true, scorePct: 100, masteryBand: 'advanced' });
  });

  it('3 of 5 correct (MCQ only) → scorePct=60 (rounds correctly)', async () => {
    // 3/5 = 0.6 = 60 exactly; test that rounding doesn't misbehave
    wireAdmin({
      attemptData: makeAttemptRow(),
      questionData: [
        { id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'B', numeric_spec: null },
        { id: 'q2', position: 2, question_type: 'mcq', correct_answer: 'A', numeric_spec: null },
        { id: 'q3', position: 3, question_type: 'mcq', correct_answer: 'C', numeric_spec: null },
        { id: 'q4', position: 4, question_type: 'mcq', correct_answer: 'D', numeric_spec: null },
        { id: 'q5', position: 5, question_type: 'mcq', correct_answer: 'A', numeric_spec: null },
      ],
      responseData: [
        { question_id: 'q1', position: 1, response_text: 'B' }, // correct
        { question_id: 'q2', position: 2, response_text: 'A' }, // correct
        { question_id: 'q3', position: 3, response_text: 'C' }, // correct
        { question_id: 'q4', position: 4, response_text: 'B' }, // wrong
        { question_id: 'q5', position: 5, response_text: 'B' }, // wrong
      ],
    });

    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toEqual({ ok: true, scorePct: 60, masteryBand: 'grade_level' });
  });

  it('open-response answers count as 0 in numerator (not scored)', async () => {
    wireAdmin({
      attemptData: makeAttemptRow(),
      questionData: [
        { id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null },
        { id: 'q2', position: 2, question_type: 'open', correct_answer: null, numeric_spec: null },
      ],
      responseData: [
        { question_id: 'q1', position: 1, response_text: 'A' }, // correct MCQ
        { question_id: 'q2', position: 2, response_text: 'A detailed answer' }, // open → counts 0
      ],
    });

    // 1 correct / 2 total = 50% → reteach
    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toEqual({ ok: true, scorePct: 50, masteryBand: 'reteach' });
  });

  it('unanswered questions count as 0 (no response row → not correct)', async () => {
    wireAdmin({
      attemptData: makeAttemptRow(),
      questionData: [
        { id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null },
        { id: 'q2', position: 2, question_type: 'mcq', correct_answer: 'B', numeric_spec: null },
      ],
      responseData: [
        { question_id: 'q1', position: 1, response_text: 'A' }, // correct
        // q2 has no response — unanswered
      ],
    });

    // 1/2 = 50% → reteach
    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toEqual({ ok: true, scorePct: 50, masteryBand: 'reteach' });
  });

  it('forfeit_reason written matches the reason arg: closure', async () => {
    let capturedPayload: Record<string, unknown> | null = null;

    fromFn.mockImplementation((table: string) => {
      if (table === 'quiz_attempts') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              single: () => Promise.resolve({ data: makeAttemptRow(), error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            capturedPayload = payload;
            return { eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'quiz_questions') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              order: (_col2: string) => Promise.resolve({
                data: [{ id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'quiz_responses') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => Promise.resolve({
              data: [{ question_id: 'q1', position: 1, response_text: 'A' }],
              error: null,
            }),
          }),
          update: (_p: unknown) => ({
            eq: (_c: string, _v: unknown) => ({
              eq: (_c2: string, _v2: unknown) => Promise.resolve({ error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected from('${table}')`);
    });

    await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload!.forfeit_reason).toBe('closure');
  });

  it('forfeit_reason written matches the reason arg: time_up', async () => {
    let capturedPayload: Record<string, unknown> | null = null;

    fromFn.mockImplementation((table: string) => {
      if (table === 'quiz_attempts') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              single: () => Promise.resolve({ data: makeAttemptRow(), error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            capturedPayload = payload;
            return { eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'quiz_questions') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              order: (_col2: string) => Promise.resolve({
                data: [{ id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'quiz_responses') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => Promise.resolve({
              data: [{ question_id: 'q1', position: 1, response_text: 'A' }],
              error: null,
            }),
          }),
          update: (_p: unknown) => ({
            eq: (_c: string, _v: unknown) => ({
              eq: (_c2: string, _v2: unknown) => Promise.resolve({ error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected from('${table}')`);
    });

    await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'time_up' });
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload!.forfeit_reason).toBe('time_up');
  });

  it('submitted_at falls back to last_active_at when no explicit value', async () => {
    let capturedPayload: Record<string, unknown> | null = null;

    fromFn.mockImplementation((table: string) => {
      if (table === 'quiz_attempts') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              single: () => Promise.resolve({
                data: makeAttemptRow({ last_active_at: '2026-06-20T09:55:00Z' }),
                error: null,
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            capturedPayload = payload;
            return { eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'quiz_questions') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              order: (_col2: string) => Promise.resolve({
                data: [{ id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'quiz_responses') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => Promise.resolve({ data: [], error: null }),
          }),
          update: (_p: unknown) => ({
            eq: (_c: string, _v: unknown) => ({
              eq: (_c2: string, _v2: unknown) => Promise.resolve({ error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected from('${table}')`);
    });

    await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload!.submitted_at).toBe('2026-06-20T09:55:00Z');
  });

  // ── Band boundary tests (computeMasteryBand: <=50 reteach / <=79 grade_level / else advanced) ──

  it('scorePct=50 → reteach (boundary: <=50 is reteach)', async () => {
    // 1 correct / 2 total = 50
    wireAdmin({
      attemptData: makeAttemptRow(),
      questionData: [
        { id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null },
        { id: 'q2', position: 2, question_type: 'mcq', correct_answer: 'B', numeric_spec: null },
      ],
      responseData: [
        { question_id: 'q1', position: 1, response_text: 'A' }, // correct
        { question_id: 'q2', position: 2, response_text: 'A' }, // wrong
      ],
    });

    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toMatchObject({ ok: true, scorePct: 50, masteryBand: 'reteach' });
  });

  it('scorePct=51 → grade_level (boundary: 51 is grade_level)', async () => {
    // Need 51/100 exactly. Use 51 questions: 51 correct. But that's impractical.
    // Use a scenario where Math.round(n/total * 100) = 51.
    // 51 of 100 is exact. Approximate: 26 of 51 = 50.98... → rounds to 51.
    // Easiest: we need ratio that gives exactly 51 after rounding.
    // 51/100: or just use 51 questions with 51 correct but mocking is easier.
    // Let's use: response data produces 51 correct out of 100 MCQ questions.
    // Actually we can do this simply: mock 100 questions, 51 correct.
    // That's verbose. Instead: use 10 questions, need Math.round(x/10*100) = 51.
    // No integer x gives that (5/10=50, 6/10=60). Need fractional.
    // Simplest: use 51 questions with 51 correct.
    // Actually for the test we mock the data, so let's do 100 questions with 51 correct:
    // that IS manageable programmatically.
    const questions = Array.from({ length: 100 }, (_, i) => ({
      id: `q${i + 1}`, position: i + 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null,
    }));
    // 51 correct, 49 wrong
    const responses = questions.map((q, i) => ({
      question_id: q.id, position: q.position,
      response_text: i < 51 ? 'A' : 'B', // first 51 correct, rest wrong
    }));

    wireAdmin({
      attemptData: makeAttemptRow(),
      questionData: questions,
      responseData: responses,
    });

    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toMatchObject({ ok: true, scorePct: 51, masteryBand: 'grade_level' });
  });

  it('scorePct=79 → grade_level (boundary: <=79 is grade_level)', async () => {
    // 79 of 100 correct
    const questions = Array.from({ length: 100 }, (_, i) => ({
      id: `q${i + 1}`, position: i + 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null,
    }));
    const responses = questions.map((q, i) => ({
      question_id: q.id, position: q.position,
      response_text: i < 79 ? 'A' : 'B',
    }));

    wireAdmin({
      attemptData: makeAttemptRow(),
      questionData: questions,
      responseData: responses,
    });

    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toMatchObject({ ok: true, scorePct: 79, masteryBand: 'grade_level' });
  });

  it('scorePct=80 → advanced (boundary: >79 is advanced)', async () => {
    // 80 of 100 correct
    const questions = Array.from({ length: 100 }, (_, i) => ({
      id: `q${i + 1}`, position: i + 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null,
    }));
    const responses = questions.map((q, i) => ({
      question_id: q.id, position: q.position,
      response_text: i < 80 ? 'A' : 'B',
    }));

    wireAdmin({
      attemptData: makeAttemptRow(),
      questionData: questions,
      responseData: responses,
    });

    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toMatchObject({ ok: true, scorePct: 80, masteryBand: 'advanced' });
  });

  it('numeric question scored correctly by value-equivalence (1/2 === 0.5)', async () => {
    wireAdmin({
      attemptData: makeAttemptRow(),
      questionData: [
        { id: 'q1', position: 1, question_type: 'numeric', correct_answer: '0.5', numeric_spec: { accepted: ['0.5'] } },
      ],
      responseData: [
        { question_id: 'q1', position: 1, response_text: '1/2' }, // value-equivalent
      ],
    });

    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toMatchObject({ ok: true, scorePct: 100, masteryBand: 'advanced' });
  });

  it('DB error reading attempt → returns {ok:false}', async () => {
    fromFn.mockImplementation((table: string) => {
      if (table === 'quiz_attempts') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              single: () => Promise.resolve({ data: null, error: { message: 'connection refused' } }),
            }),
          }),
          update: (_p: unknown) => ({ eq: (_c: string, _v: unknown) => Promise.resolve({ error: null }) }),
        };
      }
      throw new Error(`Unexpected from('${table}')`);
    });

    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toMatchObject({ ok: false });
    expect((result as { ok: false; error: string }).error).toContain('attempt not found');
  });

  it('DB error on attempt update → returns {ok:false}', async () => {
    fromFn.mockImplementation((table: string) => {
      if (table === 'quiz_attempts') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              single: () => Promise.resolve({ data: makeAttemptRow(), error: null }),
            }),
          }),
          update: (_p: unknown) => ({
            eq: (_c: string, _v: unknown) => Promise.resolve({ error: { message: 'write failed' } }),
          }),
        };
      }
      if (table === 'quiz_questions') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              order: (_col2: string) => Promise.resolve({
                data: [{ id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'quiz_responses') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => Promise.resolve({ data: [], error: null }),
          }),
          update: (_p: unknown) => ({
            eq: (_c: string, _v: unknown) => ({
              eq: (_c2: string, _v2: unknown) => Promise.resolve({ error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected from('${table}')`);
    });

    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toMatchObject({ ok: false });
    expect((result as { ok: false; error: string }).error).toContain('attempt update failed');
  });

  it('already-complete attempt → returns {ok:false} without overwriting', async () => {
    wireAdmin({
      attemptData: makeAttemptRow({ is_complete: true }),
      questionData: [],
      responseData: [],
    });

    const result = await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(result).toMatchObject({ ok: false });
    expect((result as { ok: false; error: string }).error).toContain('already complete');
  });

  it('is_complete:true written in the attempt update payload', async () => {
    let capturedPayload: Record<string, unknown> | null = null;

    fromFn.mockImplementation((table: string) => {
      if (table === 'quiz_attempts') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              single: () => Promise.resolve({ data: makeAttemptRow(), error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            capturedPayload = payload;
            return { eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'quiz_questions') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              order: (_col2: string) => Promise.resolve({
                data: [{ id: 'q1', position: 1, question_type: 'mcq', correct_answer: 'A', numeric_spec: null }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'quiz_responses') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => Promise.resolve({ data: [], error: null }),
          }),
          update: (_p: unknown) => ({
            eq: (_c: string, _v: unknown) => ({
              eq: (_c2: string, _v2: unknown) => Promise.resolve({ error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected from('${table}')`);
    });

    await forfeitAttempt({ admin: mockAdmin, attemptId: ATTEMPT_ID, reason: 'closure' });
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload!.is_complete).toBe(true);
    expect(capturedPayload!.score_pct).toBeDefined();
    expect(capturedPayload!.mastery_band).toBeDefined();
  });
});
