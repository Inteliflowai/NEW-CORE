// src/lib/misconceptions/__tests__/recordMisconceptions.test.ts
import { describe, it, expect, vi } from 'vitest';
import { recordMisconceptions } from '../recordMisconceptions';

// ── Minimal admin mock ────────────────────────────────────────────────────────
function makeAdmin(insertError: unknown = null) {
  const insertChain: Record<string, unknown> = {};
  insertChain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: insertError }).then(resolve);

  return {
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnValue(insertChain),
    })),
  };
}

describe('recordMisconceptions', () => {
  it('writes one row per OEQ response with non-none error_type', async () => {
    const admin = makeAdmin();
    const result = await recordMisconceptions(admin as never, {
      schoolId: 'school-1',
      perResponse: [
        // OEQ — should write
        {
          responseId: 'r1',
          studentId: 's1',
          skillId: 'skill-1',
          error_type: 'reasoning_gap',
          reasoning_pattern: 'partial_reasoning',
          questionTypeScored: 'open',
        },
        // OEQ — should write (skillId null is allowed)
        {
          responseId: 'r2',
          studentId: 's1',
          skillId: null,
          error_type: 'incomplete',
          reasoning_pattern: 'surface_recall',
          questionTypeScored: 'open',
        },
        // MCQ — excluded (questionTypeScored !== 'open')
        {
          responseId: 'r3',
          studentId: 's1',
          skillId: 'skill-2',
          error_type: 'factual_error',
          reasoning_pattern: 'surface_recall',
          questionTypeScored: 'mcq',
        },
        // OEQ — excluded (error_type === 'none')
        {
          responseId: 'r4',
          studentId: 's1',
          skillId: 'skill-1',
          error_type: 'none',
          reasoning_pattern: 'full_reasoning',
          questionTypeScored: 'open',
        },
      ],
    });
    // Only r1 and r2 should be written
    expect(result.written).toBe(2);
    expect(admin.from).toHaveBeenCalledWith('misconception_observations');
  });

  it('excludes numeric question_type_scored responses (same as MCQ rule)', async () => {
    const admin = makeAdmin();
    const result = await recordMisconceptions(admin as never, {
      schoolId: 'school-1',
      perResponse: [
        {
          responseId: 'r5',
          studentId: 's2',
          skillId: 'skill-3',
          error_type: 'factual_error',
          reasoning_pattern: 'surface_recall',
          questionTypeScored: 'numeric',
        },
      ],
    });
    expect(result.written).toBe(0);
  });

  it('writes rows with skill_id and real responseId uuid when provided', async () => {
    const insertSpy = vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    });
    const admin = {
      from: vi.fn(() => ({ insert: insertSpy })),
    };

    await recordMisconceptions(admin as never, {
      schoolId: 'school-1',
      perResponse: [
        {
          responseId: 'r6',
          studentId: 's3',
          skillId: 'skill-abc',
          error_type: 'vocabulary_confusion',
          reasoning_pattern: 'misconception',
          questionTypeScored: 'open',
        },
      ],
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    expect(row.skill_id).toBe('skill-abc');
    expect(row.error_type).toBe('vocabulary_confusion');
    expect(row.reasoning_pattern).toBe('misconception');
    expect(row.quiz_response_id).toBe('r6');   // real responseId uuid (C2 — not composite)
    expect(row.student_id).toBe('s3');
    expect(row.school_id).toBe('school-1');
  });

  it('null skillId still writes a row (misconception is still observed)', async () => {
    const insertSpy = vi.fn().mockReturnValue({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    });
    const admin = {
      from: vi.fn(() => ({ insert: insertSpy })),
    };

    const result = await recordMisconceptions(admin as never, {
      schoolId: 'school-1',
      perResponse: [
        {
          responseId: 'uuid-null-skill',
          studentId: 's5',
          skillId: null,
          error_type: 'reasoning_gap',
          reasoning_pattern: 'partial_reasoning',
          questionTypeScored: 'open',
        },
      ],
    });

    expect(result.written).toBe(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    expect(row.skill_id).toBeNull();
    expect(row.quiz_response_id).toBe('uuid-null-skill');
  });

  it('returns written:0 and does not throw when insert errors (fail-isolated)', async () => {
    const admin = makeAdmin({ message: 'db error' });
    const result = await recordMisconceptions(admin as never, {
      schoolId: 'school-1',
      perResponse: [
        {
          responseId: 'r7',
          studentId: 's4',
          skillId: 'skill-x',
          error_type: 'reasoning_gap',
          reasoning_pattern: 'partial_reasoning',
          questionTypeScored: 'open',
        },
      ],
    });
    // Fail-isolated: errors are swallowed, count tracks only successes
    expect(result.written).toBe(0);
  });
});
