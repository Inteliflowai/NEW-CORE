// src/lib/chapters/__tests__/generateChapterTest.test.ts
//
// TDD tests for generateChapterQuestions engine.
// Environment: node (default vitest env — no jsdom needed, pure lib).
//
// Mock strategy:
//   - resilientClaudeChat: vi.mock with wrapper fn (avoids vi.fn() hoisting bug)
//   - admin SupabaseClient: hand-rolled chainable stub (table-dispatching)
//   - CLAUDE_CHAPTER_MODEL: vi.mock to avoid env-var dependency

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';

// vi.mock is hoisted above variable declarations. Wrap in arrow fn to avoid
// ReferenceError on the outer `vi.fn()` ref (established pattern, gradeAssignment.test.ts).
const mockResilientClaudeChat = vi.fn();
vi.mock('@/lib/ai/claude', () => ({
  resilientClaudeChat: (...a: unknown[]) => mockResilientClaudeChat(...a),
}));
vi.mock('@/lib/ai/models', () => ({
  CLAUDE_CHAPTER_MODEL: 'claude-opus-4-8',
  CLAUDE_GRADING_MODEL: 'claude-sonnet-4-6',
}));

import { generateChapterQuestions, type StudentContext } from '@/lib/chapters/generateChapterTest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ────────────────────────────────────────────────────────────────────

interface SectionRow {
  id: string;
  section_order: number;
  section_kind: string;
  title: string;
  time_minutes: number;
  total_points: number;
}

// ── Fixture data ─────────────────────────────────────────────────────────────

const VOCAB_SECTION: SectionRow = {
  id: 'sec-vocab',
  section_order: 1,
  section_kind: 'vocabulary',
  title: 'Vocabulary',
  time_minutes: 8,
  total_points: 10,
};

const SHORT_ANSWER_SECTION: SectionRow = {
  id: 'sec-sa',
  section_order: 2,
  section_kind: 'short_answer',
  title: 'Short Answer',
  time_minutes: 10,
  total_points: 15,
};

const MINI_ESSAY_SECTION: SectionRow = {
  id: 'sec-me',
  section_order: 5,
  section_kind: 'mini_essay',
  title: 'Power Paragraph',
  time_minutes: 8,
  total_points: 10,
};

const STUDENT_A: StudentContext = {
  studentId: 'stu-a',
  comprehension_band: 'grade_level',
  learning_style: 'visual',
};

const STUDENT_B: StudentContext = {
  studentId: 'stu-b',
  comprehension_band: 'reteach',
  learning_style: null,
};

// Build a valid Claude response for a section with the given number of questions
function makeClaudeResponse(
  questionCount: number,
  questionType = 'short_answer',
): { content: string } {
  const questions = Array.from({ length: questionCount }, (_, i) => ({
    question_order: i + 1,
    question_type: questionType,
    question_text: `Question ${i + 1}`,
    payload: { rubric: 'Check for understanding.', expected_signals: ['key idea'] },
    points: 5,
  }));
  return { content: JSON.stringify({ questions }) };
}

// ── Admin mock factory ────────────────────────────────────────────────────────
//
// Builds a minimal Supabase admin stub that dispatches on table name.
//
// chapter_tests          — tracks `.update().eq()` status transitions via `statusUpdates`
// chapter_test_sections  — `.select().eq().order()` resolves with `sections`
// chapter_test_questions — `.select('id').eq().eq()` resolves based on `existingPairs`;
//                          `.insert(rows)` records rows in `allInserts` + returns `insertError`

function makeAdmin({
  sections,
  existingPairs = new Set<string>(),
  insertError = null,
  sectionLoadError = null,
}: {
  sections: SectionRow[];
  existingPairs?: Set<string>;
  insertError?: Record<string, unknown> | null;
  sectionLoadError?: Record<string, unknown> | null;
}) {
  const statusUpdates: string[] = [];
  const allInserts: unknown[][] = [];

  function makeChain(table: string) {
    let updateData: Record<string, unknown> | null = null;
    let isSelect = false;
    const eqs: Array<[string, string]> = [];

    const q = {
      select(_cols: string) {
        isSelect = true;
        return q;
      },
      update(data: Record<string, unknown>) {
        updateData = data;
        return q;
      },
      insert(rows: unknown[]) {
        const normalised = Array.isArray(rows) ? rows : [rows];
        allInserts.push(normalised);
        return Promise.resolve({ error: insertError ?? null });
      },
      eq(col: string, val: string) {
        eqs.push([col, val]);
        return q;
      },
      order(_col: string) {
        return q;
      },
      // PromiseLike — called when the chain is awaited
      then(
        resolve: (v: { data: unknown[]; error: unknown }) => void,
        reject: (e: unknown) => void,
      ) {
        try {
          if (table === 'chapter_tests') {
            if (updateData?.generation_status) {
              statusUpdates.push(String(updateData.generation_status));
            }
            resolve({ data: [], error: null });
          } else if (table === 'chapter_test_sections' && isSelect) {
            if (sectionLoadError) {
              resolve({ data: [], error: sectionLoadError });
            } else {
              resolve({ data: sections, error: null });
            }
          } else if (table === 'chapter_test_questions' && isSelect) {
            const sectionId = eqs.find(([k]) => k === 'section_id')?.[1] ?? '';
            const studentId = eqs.find(([k]) => k === 'student_id')?.[1] ?? '';
            const key = `${sectionId}:${studentId}`;
            resolve({
              data: existingPairs.has(key) ? [{ id: 'pre-existing' }] : [],
              error: null,
            });
          } else {
            resolve({ data: [], error: null });
          }
        } catch (err) {
          reject(err);
        }
      },
    };
    return q;
  }

  const admin = {
    statusUpdates,
    allInserts,
    from(table: string) {
      return makeChain(table);
    },
  };

  return admin;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockResilientClaudeChat.mockReset();
});

describe('generateChapterQuestions — status transitions', () => {
  it('transitions generation_status: generating → ready on success', async () => {
    // vocabulary = 6 questions
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(6));

    const admin = makeAdmin({ sections: [VOCAB_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-1',
      students: [STUDENT_A],
      lessonTexts: ['Lesson content about vocabulary'],
      template: 'humanities',
    });

    expect(admin.statusUpdates[0]).toBe('generating');
    expect(admin.statusUpdates[admin.statusUpdates.length - 1]).toBe('ready');
    expect(admin.statusUpdates).toHaveLength(2);
  });

  it('transitions generation_status: generating → failed when LlmExhaustedError is thrown', async () => {
    mockResilientClaudeChat.mockRejectedValue(new LlmExhaustedError('claude', new Error('exhausted')));

    const admin = makeAdmin({ sections: [SHORT_ANSWER_SECTION] });

    // Must NOT throw (caller is after())
    await expect(
      generateChapterQuestions({
        admin: admin as unknown as SupabaseClient,
        chapterTestId: 'test-2',
        students: [STUDENT_A],
        lessonTexts: ['Lesson'],
        template: 'humanities',
      }),
    ).resolves.toBeUndefined();

    expect(admin.statusUpdates[0]).toBe('generating');
    expect(admin.statusUpdates[admin.statusUpdates.length - 1]).toBe('failed');
  });

  it('transitions to failed when sections cannot be loaded', async () => {
    const admin = makeAdmin({
      sections: [],
      sectionLoadError: { message: 'DB connection error' },
    });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-3',
      students: [STUDENT_A],
      lessonTexts: [],
      template: 'humanities',
    });

    expect(admin.statusUpdates).toContain('failed');
    expect(admin.statusUpdates).not.toContain('ready');
  });
});

describe('generateChapterQuestions — question insertion', () => {
  it('inserts correct question rows for a single student + single section', async () => {
    // short_answer = 2 questions per template
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(2, 'short_answer'));

    const admin = makeAdmin({ sections: [SHORT_ANSWER_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-4',
      students: [STUDENT_A],
      lessonTexts: ['Lesson text'],
      template: 'humanities',
    });

    expect(admin.allInserts).toHaveLength(1);
    const rows = admin.allInserts[0] as Array<{
      section_id: string;
      student_id: string;
      question_order: number;
      question_type: string;
      comprehension_band: string | null;
      learning_style: string | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].section_id).toBe('sec-sa');
    expect(rows[0].student_id).toBe('stu-a');
    expect(rows[0].question_order).toBe(1);
    expect(rows[1].question_order).toBe(2);
    expect(rows[0].comprehension_band).toBe('grade_level');
    expect(rows[0].learning_style).toBe('visual');
  });

  it('snapshots comprehension_band + learning_style (including nulls) on each row', async () => {
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(1));

    const admin = makeAdmin({ sections: [MINI_ESSAY_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-5',
      students: [STUDENT_B],
      lessonTexts: ['Text'],
      template: 'humanities',
    });

    const rows = admin.allInserts[0] as Array<{ comprehension_band: string | null; learning_style: string | null }>;
    expect(rows[0].comprehension_band).toBe('reteach');
    expect(rows[0].learning_style).toBeNull();
  });

  it('processes multiple students serially: each gets their own rows', async () => {
    // short_answer = 2 questions per template
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(2, 'short_answer'));

    const admin = makeAdmin({ sections: [SHORT_ANSWER_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-6',
      students: [STUDENT_A, STUDENT_B],
      lessonTexts: ['Lesson'],
      template: 'humanities',
    });

    // 2 students × 1 section = 2 insert calls
    expect(admin.allInserts).toHaveLength(2);
    const rowsA = admin.allInserts[0] as Array<{ student_id: string }>;
    const rowsB = admin.allInserts[1] as Array<{ student_id: string }>;
    expect(rowsA[0].student_id).toBe('stu-a');
    expect(rowsB[0].student_id).toBe('stu-b');
    // Claude called once per (student × section)
    expect(mockResilientClaudeChat).toHaveBeenCalledTimes(2);
  });
});

describe('generateChapterQuestions — points distribution', () => {
  it('distributes points evenly; last question absorbs the remainder', async () => {
    // short_answer: 2 questions, 15 total_points → [7, 8]
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(2, 'short_answer'));

    const admin = makeAdmin({ sections: [SHORT_ANSWER_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-7',
      students: [STUDENT_A],
      lessonTexts: ['Lesson'],
      template: 'humanities',
    });

    const rows = admin.allInserts[0] as Array<{ points: number }>;
    expect(rows[0].points).toBe(7);
    expect(rows[1].points).toBe(8);
    // Total matches section total_points
    expect(rows.reduce((s, r) => s + r.points, 0)).toBe(15);
  });

  it('vocabulary: 6 questions, 10 pts → first 5 get 1pt each, last gets 5pt', async () => {
    // vocabulary = 6 questions per template
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(6, 'matching'));

    const admin = makeAdmin({ sections: [VOCAB_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-8',
      students: [STUDENT_A],
      lessonTexts: ['Vocabulary lesson'],
      template: 'humanities',
    });

    const rows = admin.allInserts[0] as Array<{ points: number }>;
    expect(rows).toHaveLength(6);
    // First 5 = 1pt, last = 5pt
    for (let i = 0; i < 5; i++) expect(rows[i].points).toBe(1);
    expect(rows[5].points).toBe(5);
    expect(rows.reduce((s, r) => s + r.points, 0)).toBe(10);
  });

  it('mini_essay: 1 question, 10 pts → single question gets all 10pts', async () => {
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(1, 'mini_essay'));

    const admin = makeAdmin({ sections: [MINI_ESSAY_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-9',
      students: [STUDENT_A],
      lessonTexts: ['Essay lesson'],
      template: 'humanities',
    });

    const rows = admin.allInserts[0] as Array<{ points: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].points).toBe(10);
  });
});

describe('generateChapterQuestions — idempotency', () => {
  it('skips (section_id, student_id) pairs that already have questions', async () => {
    const admin = makeAdmin({
      sections: [SHORT_ANSWER_SECTION],
      existingPairs: new Set(['sec-sa:stu-a']),
    });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-10',
      students: [STUDENT_A],
      lessonTexts: ['Lesson'],
      template: 'humanities',
    });

    // Claude should NOT be called — pre-existing pair is skipped
    expect(mockResilientClaudeChat).not.toHaveBeenCalled();
    // No inserts for the pre-existing pair
    expect(admin.allInserts).toHaveLength(0);
    // Still marks ready
    expect(admin.statusUpdates).toContain('ready');
  });

  it('generates only the missing student when one already has questions', async () => {
    // sec-sa:stu-a already exists; sec-sa:stu-b does not
    const admin = makeAdmin({
      sections: [SHORT_ANSWER_SECTION],
      existingPairs: new Set(['sec-sa:stu-a']),
    });
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(2, 'short_answer'));

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-11',
      students: [STUDENT_A, STUDENT_B],
      lessonTexts: ['Lesson'],
      template: 'humanities',
    });

    // Only 1 insert (for stu-b)
    expect(admin.allInserts).toHaveLength(1);
    const rows = admin.allInserts[0] as Array<{ student_id: string }>;
    expect(rows[0].student_id).toBe('stu-b');
    // Claude called once (for stu-b only)
    expect(mockResilientClaudeChat).toHaveBeenCalledTimes(1);
  });
});

describe('generateChapterQuestions — fail-soft error handling', () => {
  it('never throws even when LlmExhaustedError is thrown', async () => {
    mockResilientClaudeChat.mockRejectedValue(new LlmExhaustedError('claude', new Error('rate limited')));

    const admin = makeAdmin({ sections: [SHORT_ANSWER_SECTION] });

    // This must resolve (never reject)
    await expect(
      generateChapterQuestions({
        admin: admin as unknown as SupabaseClient,
        chapterTestId: 'test-12',
        students: [STUDENT_A],
        lessonTexts: ['Lesson'],
        template: 'humanities',
      }),
    ).resolves.toBeUndefined();
  });

  it('skips a section when Claude returns invalid JSON; continues to next section', async () => {
    // First section call returns invalid JSON; second returns valid
    mockResilientClaudeChat
      .mockResolvedValueOnce({ content: 'not valid json {{{' }) // section 1 (short_answer) — broken
      .mockResolvedValueOnce(makeClaudeResponse(1, 'mini_essay'));  // section 2 (mini_essay) — good

    const admin = makeAdmin({ sections: [SHORT_ANSWER_SECTION, MINI_ESSAY_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-13',
      students: [STUDENT_A],
      lessonTexts: ['Lesson'],
      template: 'humanities',
    });

    // Only 1 insert (the mini_essay section succeeded)
    expect(admin.allInserts).toHaveLength(1);
    const rows = admin.allInserts[0] as Array<{ section_id: string }>;
    expect(rows[0].section_id).toBe('sec-me');
    // Status still reaches 'ready'
    expect(admin.statusUpdates).toContain('ready');
  });

  it('skips a section when Claude returns null content; does not mark failed', async () => {
    mockResilientClaudeChat.mockResolvedValue(null);

    const admin = makeAdmin({ sections: [SHORT_ANSWER_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-14',
      students: [STUDENT_A],
      lessonTexts: ['Lesson'],
      template: 'humanities',
    });

    // No insert (Claude returned null)
    expect(admin.allInserts).toHaveLength(0);
    // Still marks ready (null response is not LlmExhaustedError — fail-soft)
    expect(admin.statusUpdates).toContain('ready');
    expect(admin.statusUpdates).not.toContain('failed');
  });
});

describe('generateChapterQuestions — Claude call parameters', () => {
  it('does NOT pass temperature to resilientClaudeChat (opus-4.x causes 400)', async () => {
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(2, 'short_answer'));

    const admin = makeAdmin({ sections: [SHORT_ANSWER_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-15',
      students: [STUDENT_A],
      lessonTexts: ['Lesson'],
      template: 'humanities',
    });

    expect(mockResilientClaudeChat).toHaveBeenCalledTimes(1);
    const [callArgs] = mockResilientClaudeChat.mock.calls[0] as [Record<string, unknown>];
    // temperature must be absent (not just undefined — a key of undefined would still cause issues)
    expect('temperature' in callArgs).toBe(false);
  });

  it('passes CLAUDE_CHAPTER_MODEL as the model', async () => {
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(1, 'mini_essay'));

    const admin = makeAdmin({ sections: [MINI_ESSAY_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-16',
      students: [STUDENT_A],
      lessonTexts: ['Lesson'],
      template: 'humanities',
    });

    const [callArgs] = mockResilientClaudeChat.mock.calls[0] as [Record<string, unknown>];
    expect(callArgs.model).toBe('claude-opus-4-8');
  });

  it('passes max_tokens: 2000', async () => {
    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(1, 'mini_essay'));

    const admin = makeAdmin({ sections: [MINI_ESSAY_SECTION] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-17',
      students: [STUDENT_A],
      lessonTexts: ['Lesson'],
      template: 'humanities',
    });

    const [callArgs] = mockResilientClaudeChat.mock.calls[0] as [Record<string, unknown>];
    expect(callArgs.max_tokens).toBe(2000);
  });
});

describe('generateChapterQuestions — STEM template', () => {
  it('uses stem template for section 5 (multi_step_problem, 1 question)', async () => {
    const stemSection5: SectionRow = {
      id: 'sec-msp',
      section_order: 5,
      section_kind: 'multi_step_problem',
      title: 'Multi-Step Problem',
      time_minutes: 8,
      total_points: 10,
    };

    mockResilientClaudeChat.mockResolvedValue(makeClaudeResponse(1, 'multi_step_problem'));

    const admin = makeAdmin({ sections: [stemSection5] });

    await generateChapterQuestions({
      admin: admin as unknown as SupabaseClient,
      chapterTestId: 'test-18',
      students: [STUDENT_A],
      lessonTexts: ['Math lesson'],
      template: 'stem',
    });

    expect(admin.allInserts).toHaveLength(1);
    const rows = admin.allInserts[0] as Array<{ question_order: number; section_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].section_id).toBe('sec-msp');
    expect(rows[0].question_order).toBe(1);
  });
});
