// src/lib/skills/__tests__/recomputeSkillStates.test.ts
// TDD tests for recomputeSkillStatesForStudent.
// Mocked admin client; imports vitest names explicitly.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recomputeSkillStatesForStudent } from '../recomputeSkillStates';

// ── Mock admin client builder ──────────────────────────────────────────────────
// Each table returns its own data set; upsert is a separate spy.
function makeAdmin({
  quizResponses = [] as object[],
  hwAttempts = [] as object[],
  assignments = [] as object[],
  upsertError = null as { message: string; code: string } | null,
  studentSchoolId = null as string | null,
} = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError });

  // Proxy-based chainable mock that resolves to { data, error: null } when awaited.
  function makeChain(data: object[]): unknown {
    const methods: Record<string, unknown> = {};
    const proxyHandler: ProxyHandler<typeof methods> = {
      get(target, prop) {
        if (prop === 'then') {
          return (resolve: (v: { data: object[]; error: null }) => void) =>
            Promise.resolve({ data, error: null }).then(resolve);
        }
        if (prop === 'upsert') return upsert;
        // All other chain calls return the same proxy
        return (..._args: unknown[]) => proxy;
      },
    };
    const proxy = new Proxy(methods, proxyHandler);
    return proxy;
  }

  // For users table (school_id lookup): .single() must resolve to { data: object, error: null }
  // (not an array) so userData?.school_id works correctly.
  function makeUsersChain(schoolId: string | null): unknown {
    const singleResult = { data: schoolId ? { school_id: schoolId } : null, error: null };
    const methods: Record<string, unknown> = {};
    const proxyHandler: ProxyHandler<typeof methods> = {
      get(_target, prop) {
        if (prop === 'then') {
          // If awaited directly (not via .single()), return array form
          return (resolve: (v: unknown) => void) =>
            Promise.resolve({ data: schoolId ? [{ school_id: schoolId }] : [], error: null }).then(resolve);
        }
        if (prop === 'single') {
          // .single() returns a promise resolving to { data: {school_id}, error }
          return () => Promise.resolve(singleResult);
        }
        // All other chain calls (.select, .eq, etc.) return the same proxy
        return (..._args: unknown[]) => proxy;
      },
    };
    const proxy = new Proxy(methods, proxyHandler);
    return proxy;
  }

  const usersChain = makeUsersChain(studentSchoolId);

  return {
    from: vi.fn((tableName: string) => {
      if (tableName === 'quiz_responses') return makeChain(quizResponses);
      if (tableName === 'assignments') return makeChain(assignments);
      if (tableName === 'homework_attempts') return makeChain(hwAttempts);
      if (tableName === 'users') return usersChain;
      if (tableName === 'skill_learning_state') {
        // Return a chain whose .upsert is the spy
        return {
          upsert,
        };
      }
      return makeChain([]);
    }),
    _upsert: upsert,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('recomputeSkillStatesForStudent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── C11 signature ──────────────────────────────────────────────────────────
  it('accepts the object signature { studentId, schoolId, skillIds? }', async () => {
    const admin = makeAdmin();
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    expect(result.skillsRecomputed).toBe(0);
    expect(result.states).toEqual({});
  });

  // ── C20: MCQ via is_correct ───────────────────────────────────────────────
  it('C20 MCQ: gathers MCQ correctness from is_correct (no filter drops MCQ)', async () => {
    const admin = makeAdmin({
      quizResponses: [
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-mcq' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
        {
          is_correct: false,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-mcq' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-11T00:00:00Z' },
        },
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-mcq' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-12T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    expect(result.skillsRecomputed).toBe(1);
    expect(result.states['skill-mcq']).toBeDefined();
    expect(result.states['skill-mcq']).not.toBe('not_attempted');
    // upsert called once for the one skill
    expect(admin._upsert).toHaveBeenCalledTimes(1);
    // upsert called with school_id (C11)
    const upsertArg = admin._upsert.mock.calls[0][0];
    expect(upsertArg.school_id).toBe('school-1');
  });

  // ── C20: OEQ via ai_score >= 0.5 ─────────────────────────────────────────
  it('C20 OEQ: derives correctness from ai_score>=0.5 (not is_correct)', async () => {
    const admin = makeAdmin({
      quizResponses: [
        {
          is_correct: null,       // OEQ — no is_correct
          ai_score: 0.8,          // >= 0.5 → correct
          question_type_scored: 'open',
          grading_output: { error_type: 'none', reasoning_pattern: 'full_reasoning' },
          quiz_questions: { skill_id: 'skill-oeq' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
        {
          is_correct: null,
          ai_score: 0.3,          // < 0.5 → incorrect
          question_type_scored: 'open',
          grading_output: { error_type: 'reasoning_gap', reasoning_pattern: null },
          quiz_questions: { skill_id: 'skill-oeq' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-11T00:00:00Z' },
        },
        {
          is_correct: null,
          ai_score: 0.5,          // exactly 0.5 → correct (boundary)
          question_type_scored: 'open',
          grading_output: { error_type: null, reasoning_pattern: 'full_reasoning' },
          quiz_questions: { skill_id: 'skill-oeq' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-12T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    expect(result.skillsRecomputed).toBe(1);
    expect(result.states['skill-oeq']).toBeDefined();
    expect(admin._upsert).toHaveBeenCalledTimes(1);
  });

  // ── C20: BOTH question types gathered without is_correct IS NOT NULL filter ──
  it('C20 BOTH: gathers MCQ and OEQ in the same pass without dropping OEQ', async () => {
    const admin = makeAdmin({
      quizResponses: [
        // MCQ
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-mix' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
        // OEQ (is_correct=null — would be dropped by is_correct IS NOT NULL filter)
        {
          is_correct: null,
          ai_score: 0.7,
          question_type_scored: 'open',
          grading_output: { error_type: 'none', reasoning_pattern: null },
          quiz_questions: { skill_id: 'skill-mix' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-11T00:00:00Z' },
        },
        {
          is_correct: null,
          ai_score: 0.9,
          question_type_scored: 'open',
          grading_output: { error_type: 'none', reasoning_pattern: 'full_reasoning' },
          quiz_questions: { skill_id: 'skill-mix' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-12T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    // 3 observations gathered (1 MCQ + 2 OEQ)
    expect(result.skillsRecomputed).toBe(1);
    expect(result.states['skill-mix']).toBeDefined();
    expect(result.states['skill-mix']).not.toBe('not_attempted');
    expect(result.states['skill-mix']).not.toBe('insufficient_data');
  });

  // ── C10: homework uses score_pct/teacher_score, effort_label ─────────────
  it('C10 HW: gathers homework from score_pct/teacher_score/effort_label (no phantom grade column)', async () => {
    const admin = makeAdmin({
      assignments: [
        {
          id: 'asg-1',
          skill_ids: ['skill-hw'],
          reteach_needed: false,
          allow_redo: false,
          is_redo: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      hwAttempts: [
        {
          assignment_id: 'asg-1',
          student_id: 'stu-1',
          status: 'graded',
          score_pct: 72,
          teacher_score: null,
          effort_label: 'struggling_trying',
          allow_redo: false,
          is_redo: false,
          submitted_at: '2026-01-15T00:00:00Z',
          graded_at: '2026-01-16T00:00:00Z',
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    expect(result.skillsRecomputed).toBe(1);
    // teacher_score preferred; falls back to score_pct
    const upsertArg = admin._upsert.mock.calls[0][0];
    // evidence.metrics.hw_avg should reflect 72 (score_pct)
    expect(upsertArg.observation_count).toBeGreaterThan(0);
  });

  it('C10 HW: teacher_score takes precedence over score_pct when both present', async () => {
    const admin = makeAdmin({
      assignments: [
        {
          id: 'asg-2',
          skill_ids: ['skill-hw2'],
          reteach_needed: false,
          allow_redo: false,
          is_redo: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      hwAttempts: [
        {
          assignment_id: 'asg-2',
          student_id: 'stu-1',
          status: 'graded',
          score_pct: 60,
          teacher_score: 85,   // should win
          effort_label: 'effortful_success',
          allow_redo: false,
          is_redo: false,
          submitted_at: '2026-01-20T00:00:00Z',
          graded_at: '2026-01-21T00:00:00Z',
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    // teacher_score (85) used → evidence metrics hw_avg should be 85
    const upsertArg = admin._upsert.mock.calls[0][0];
    expect(upsertArg.evidence.metrics.hw_avg).toBe(85);
  });

  // ── C19: sessionErrorPatterns from graded-OEQ grading_output via map ─────
  it('C19: sessionErrorPatterns derived from graded-OEQ grading_output via toSessionErrorPattern map', async () => {
    const admin = makeAdmin({
      quizResponses: [
        {
          is_correct: null,
          ai_score: 0.2,             // incorrect
          question_type_scored: 'open',
          grading_output: { error_type: 'reasoning_gap', reasoning_pattern: null },
          quiz_questions: { skill_id: 'skill-ep' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
        {
          is_correct: null,
          ai_score: 0.1,
          question_type_scored: 'open',
          grading_output: { error_type: null, reasoning_pattern: 'misconception' },
          quiz_questions: { skill_id: 'skill-ep' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-11T00:00:00Z' },
        },
        {
          is_correct: null,
          ai_score: 0.1,
          question_type_scored: 'open',
          grading_output: { error_type: 'none', reasoning_pattern: null },
          quiz_questions: { skill_id: 'skill-ep' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-12T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    // The upsert evidence should have conceptual patterns from reasoning_gap and misconception
    const upsertArg = admin._upsert.mock.calls[0][0];
    // conceptual_share should be > 0 (at least 2/3 conceptual patterns)
    expect(upsertArg.evidence.metrics.conceptual_share).toBeGreaterThan(0);
  });

  it('C19: sessionErrorPatterns NOT sourced from MCQ (only graded-OEQ grading_output)', async () => {
    const admin = makeAdmin({
      quizResponses: [
        // MCQ rows — should NOT contribute to sessionErrorPatterns
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,   // MCQs have no grading_output
          quiz_questions: { skill_id: 'skill-mcq-only' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
        {
          is_correct: false,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-mcq-only' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-11T00:00:00Z' },
        },
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-mcq-only' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-12T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    // conceptual_share should be null — no OEQ patterns
    const upsertArg = admin._upsert.mock.calls[0][0];
    expect(upsertArg.evidence.metrics.conceptual_share).toBeNull();
  });

  // ── C10: reteach null when not determinable ────────────────────────────────
  it('C10 reteach: passes reteach:null when no redo attempts exist', async () => {
    const admin = makeAdmin({
      quizResponses: [
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-ret' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-ret' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-11T00:00:00Z' },
        },
        {
          is_correct: false,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-ret' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-12T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    // last_reteach_outcome should be null (no reteach events)
    const upsertArg = admin._upsert.mock.calls[0][0];
    expect(upsertArg.last_reteach_outcome).toBeNull();
  });

  it('C10 reteach: derives more_practice reteach from is_redo=true + graded attempt', async () => {
    const admin = makeAdmin({
      assignments: [
        {
          id: 'asg-redo',
          skill_ids: ['skill-redo'],
          reteach_needed: false,
          allow_redo: true,
          is_redo: false,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      hwAttempts: [
        {
          assignment_id: 'asg-redo',
          student_id: 'stu-1',
          status: 'graded',
          score_pct: 80,
          teacher_score: null,
          effort_label: null,
          allow_redo: true,
          is_redo: true,          // redo attempt
          flagged_by: null,
          submitted_at: '2026-01-20T00:00:00Z',
          graded_at: '2026-01-21T00:00:00Z',
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    // reteach derived from redo — last_reteach_outcome should be set
    const upsertArg = admin._upsert.mock.calls[0][0];
    // Should have a reteach_pending_cold_check or similar (not null)
    expect(upsertArg.last_reteach_outcome).toBeTruthy();
  });

  // ── C11: upserts with school_id ───────────────────────────────────────────
  it('C11: upserts skill_learning_state with school_id from args', async () => {
    const admin = makeAdmin({
      quizResponses: [
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-upsert' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-upsert' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-11T00:00:00Z' },
        },
        {
          is_correct: false,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-upsert' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-12T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-42',
    });
    expect(result.ok).toBe(true);
    const upsertArg = admin._upsert.mock.calls[0][0];
    expect(upsertArg.school_id).toBe('school-42');
    expect(upsertArg.student_id).toBe('stu-1');
    expect(upsertArg.skill_id).toBe('skill-upsert');
  });

  // ── IMPORTANT-1: school_id resolved from users when caller passes null ───────
  it('IMPORTANT-1: when schoolId is null, resolves school_id from users.school_id (RLS-visible rows)', async () => {
    const admin = makeAdmin({
      studentSchoolId: 'school-from-db',
      quizResponses: [
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-rls' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-rls' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-11T00:00:00Z' },
        },
        {
          is_correct: false,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-rls' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-12T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: null, // caller passes null — must be resolved from users
    });
    expect(result.ok).toBe(true);
    expect(result.skillsRecomputed).toBe(1);
    // users table must have been queried for school_id
    expect(admin.from).toHaveBeenCalledWith('users');
    // upserted row carries the real school_id (not null)
    const upsertArg = admin._upsert.mock.calls[0][0];
    expect(upsertArg.school_id).toBe('school-from-db');
  });

  it('IMPORTANT-1: when schoolId is null and users has no school_id, upserts with null (graceful fallback)', async () => {
    const admin = makeAdmin({
      studentSchoolId: null, // no school in DB either
      quizResponses: [
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-noschool' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-noschool' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-11T00:00:00Z' },
        },
        {
          is_correct: false,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-noschool' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-12T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: null,
    });
    expect(result.ok).toBe(true);
    // upserted row carries null (graceful — no school on user record)
    const upsertArg = admin._upsert.mock.calls[0][0];
    expect(upsertArg.school_id).toBeNull();
  });

  // ── skillIds filter ────────────────────────────────────────────────────────
  it('limits recompute to skillIds when provided (ignores other touched skills)', async () => {
    const admin = makeAdmin({
      quizResponses: [
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-abc' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
      skillIds: ['skill-xyz'],
    });
    expect(result.ok).toBe(true);
    expect(result.skillsRecomputed).toBe(1);
    // skill-xyz was forced; skill-abc should not appear
    expect(result.states['skill-abc']).toBeUndefined();
    expect(result.states['skill-xyz']).toBeDefined();
  });

  // ── Error handling ─────────────────────────────────────────────────────────
  it('returns ok:false + reason:upsert_failed when upsert errors', async () => {
    const admin = makeAdmin({
      quizResponses: [
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-abc' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-abc' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-11T00:00:00Z' },
        },
        {
          is_correct: false,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: 'skill-abc' },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-12T00:00:00Z' },
        },
      ],
      upsertError: { message: 'relation does not exist', code: '42P01' },
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('upsert_failed');
    expect(result.skillsRecomputed).toBe(0);
  });

  it('returns ok:false + reason:exception when admin.from throws', async () => {
    const badAdmin = {
      from: vi.fn(() => { throw new Error('connection reset'); }),
    };
    const result = await recomputeSkillStatesForStudent(badAdmin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('exception');
    expect(result.skillsRecomputed).toBe(0);
  });

  it('skips rows with null skill_id (no skill tag)', async () => {
    const admin = makeAdmin({
      quizResponses: [
        {
          is_correct: true,
          ai_score: null,
          question_type_scored: 'mcq',
          grading_output: null,
          quiz_questions: { skill_id: null },
          quiz_attempts: { student_id: 'stu-1', is_complete: true, submitted_at: '2026-01-10T00:00:00Z' },
        },
      ],
    });
    const result = await recomputeSkillStatesForStudent(admin as never, {
      studentId: 'stu-1',
      schoolId: 'school-1',
    });
    expect(result.ok).toBe(true);
    expect(result.skillsRecomputed).toBe(0);
    expect(admin._upsert).not.toHaveBeenCalled();
  });
});
