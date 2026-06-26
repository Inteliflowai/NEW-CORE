// Tests for POST /api/teacher/chapter-tests
// TDD: these run against the implementation in ../route.ts
//
// Strategy:
//   - auth/role/404/403 error paths are pure synchronous tests.
//   - 200 success path verifies chapter_tests row + 5 sections are created + returns { chapter_test_id }.
//   - after() is mocked to run synchronously via Promise.resolve().then(cb).
//     A separate test captures the after() callback and verifies generateChapterQuestions is called.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Mutable state (read by factory closures at call-time) ─────────────────────
const getUserMock = vi.fn();
const profileSingleMock = vi.fn();
const guardFn = vi.fn();
const generateChapterQuestionsMock = vi.fn();

// DB state vars
let chapterData: unknown = { id: 'ch1', class_id: 'cl1' };
let chapterError: unknown = null;
let testInsertData: unknown = { id: 'ct-new' };
let testInsertError: unknown = null;
let sectionsInsertError: unknown = null;
let enrollmentsData: unknown = [{ student_id: 'stu1' }, { student_id: 'stu2' }];
let signalsData: unknown = [];
let lessonRowsData: unknown = [];
// Track what sectionRows were inserted
const sectionInsertSpy = vi.fn();
const chapterTestInsertSpy = vi.fn();
const chapterTestUpdateSpy = vi.fn();

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: profileSingleMock,
        }),
      }),
    }),
  }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'chapters') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: chapterData, error: chapterError }),
            }),
          }),
        };
      }
      if (t === 'chapter_tests') {
        return {
          insert: (row: unknown) => {
            chapterTestInsertSpy(row);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: testInsertData, error: testInsertError }),
              }),
            };
          },
          update: (data: unknown) => {
            chapterTestUpdateSpy(data);
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            };
          },
        };
      }
      if (t === 'chapter_test_sections') {
        return {
          insert: (rows: unknown) => {
            sectionInsertSpy(rows);
            return Promise.resolve({ data: null, error: sectionsInsertError });
          },
        };
      }
      if (t === 'enrollments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({ data: enrollmentsData, error: null }),
            }),
          }),
        };
      }
      if (t === 'behavioral_signals') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({ data: signalsData, error: null }),
          }),
        };
      }
      if (t === 'lessons') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({ data: lessonRowsData, error: null }),
          }),
        };
      }
      return {};
    },
  }),
}));

// after() runs the callback asynchronously in a microtask (mirrors quizzes/generate pattern)
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (cb: () => void) => {
    void Promise.resolve().then(cb);
  },
}));

vi.mock('@/lib/auth/guards', () => ({
  guardClassAccess: (...a: unknown[]) => guardFn(...a),
}));

vi.mock('@/lib/auth/roles', () => ({
  STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'],
}));

vi.mock('@/lib/chapters/generateChapterTest', () => ({
  generateChapterQuestions: (...a: unknown[]) => generateChapterQuestionsMock(...a),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(body: object): NextRequest {
  return new NextRequest('http://x/api/teacher/chapter-tests', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

// ── beforeEach defaults ────────────────────────────────────────────────────────
beforeEach(() => {
  getUserMock.mockReset();
  profileSingleMock.mockReset();
  guardFn.mockReset();
  generateChapterQuestionsMock.mockReset();
  sectionInsertSpy.mockReset();
  chapterTestInsertSpy.mockReset();
  chapterTestUpdateSpy.mockReset();

  // Default: authenticated teacher
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  profileSingleMock.mockResolvedValue({ data: { role: 'teacher' } });
  guardFn.mockResolvedValue(null); // allow

  // Default DB state
  chapterData = { id: 'ch1', class_id: 'cl1' };
  chapterError = null;
  testInsertData = { id: 'ct-new' };
  testInsertError = null;
  sectionsInsertError = null;
  enrollmentsData = [{ student_id: 'stu1' }, { student_id: 'stu2' }];
  signalsData = [];
  lessonRowsData = [];

  // generateChapterQuestions is a no-op by default
  generateChapterQuestionsMock.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/teacher/chapter-tests', () => {
  // ── Auth / role guards ─────────────────────────────────────────────────────

  it('401 when no authenticated user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));
    expect(res.status).toBe(401);
  });

  it('403 when user is not a staff role (student)', async () => {
    profileSingleMock.mockResolvedValue({ data: { role: 'student' } });
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));
    expect(res.status).toBe(403);
    // Guard should not be called before role check
    expect(guardFn).not.toHaveBeenCalled();
  });

  it('403 when user is a parent (non-staff)', async () => {
    profileSingleMock.mockResolvedValue({ data: { role: 'parent' } });
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));
    expect(res.status).toBe(403);
  });

  // ── Input validation ───────────────────────────────────────────────────────

  it('400 when chapterId is missing', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ title: 'Test', template: 'humanities' }));
    expect(res.status).toBe(400);
  });

  it('400 when title is missing', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', template: 'humanities' }));
    expect(res.status).toBe(400);
  });

  it('400 when title is blank (whitespace)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: '   ', template: 'humanities' }));
    expect(res.status).toBe(400);
  });

  it('400 when template is invalid', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'invalid' }));
    expect(res.status).toBe(400);
  });

  // ── Chapter not found ──────────────────────────────────────────────────────

  it('404 when chapter not found (no row)', async () => {
    chapterData = null;
    chapterError = null;
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch-nonexistent', title: 'Test', template: 'humanities' }));
    expect(res.status).toBe(404);
  });

  it('404 when chapter DB query returns an error', async () => {
    chapterData = null;
    chapterError = { message: 'DB error' };
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));
    expect(res.status).toBe(404);
  });

  // ── IDOR guard ─────────────────────────────────────────────────────────────

  it("403 when teacher doesn't own the class (guardClassAccess denies)", async () => {
    guardFn.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));
    expect(res.status).toBe(403);
    // Guard must be called with the chapter's class_id
    expect(guardFn).toHaveBeenCalledWith('cl1');
  });

  // ── 500 paths ─────────────────────────────────────────────────────────────

  it('500 when chapter_tests insert fails', async () => {
    testInsertData = null;
    testInsertError = { message: 'constraint violation' };
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));
    expect(res.status).toBe(500);
  });

  it('500 when chapter_test_sections insert fails + marks generation_status=failed', async () => {
    sectionsInsertError = { message: 'sections insert failed' };
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));
    expect(res.status).toBe(500);
    // Should update generation_status='failed' on the chapter_tests row
    expect(chapterTestUpdateSpy).toHaveBeenCalledWith({ generation_status: 'failed' });
  });

  // ── Success path ───────────────────────────────────────────────────────────

  it('200 + returns { chapter_test_id } on success', async () => {
    testInsertData = { id: 'ct-abc123' };
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Chapter 1 Test', template: 'humanities' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chapter_test_id).toBe('ct-abc123');
  });

  it('creates chapter_tests row with correct fields', async () => {
    testInsertData = { id: 'ct-xyz' };
    const { POST } = await import('../route');
    await POST(makeRequest({ chapterId: 'ch1', title: 'My Test', template: 'stem' }));
    expect(chapterTestInsertSpy).toHaveBeenCalledOnce();
    const inserted = chapterTestInsertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.chapter_id).toBe('ch1');
    expect(inserted.class_id).toBe('cl1');
    expect(inserted.teacher_id).toBe('u1');
    expect(inserted.title).toBe('My Test');
    expect(inserted.template).toBe('stem');
    expect(inserted.generation_status).toBe('queued');
    expect(inserted.status).toBe('draft');
    expect(inserted.total_minutes).toBe(44);
    expect(inserted.total_points).toBe(60);
  });

  it('inserts exactly 5 chapter_test_sections matching the template', async () => {
    testInsertData = { id: 'ct-xyz' };
    const { POST } = await import('../route');
    await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));
    expect(sectionInsertSpy).toHaveBeenCalledOnce();
    const rows = sectionInsertSpy.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(5);
    // All rows should reference the chapter test id
    expect(rows.every((r) => r.chapter_test_id === 'ct-xyz')).toBe(true);
    // Section orders should be 1-5
    const orders = rows.map((r) => r.section_order).sort();
    expect(orders).toEqual([1, 2, 3, 4, 5]);
    // Section kinds should match humanities template
    const kinds = rows.map((r) => r.section_kind);
    expect(kinds).toContain('vocabulary');
    expect(kinds).toContain('mini_essay');
    // Total points should sum to 60
    const totalPoints = (rows as Array<{ total_points: number }>)
      .reduce((sum, r) => sum + r.total_points, 0);
    expect(totalPoints).toBe(60);
    // Total minutes should sum to 44
    const totalMinutes = (rows as Array<{ time_minutes: number }>)
      .reduce((sum, r) => sum + r.time_minutes, 0);
    expect(totalMinutes).toBe(44);
  });

  it('stem template uses multi_step_problem for section 5', async () => {
    testInsertData = { id: 'ct-stem' };
    const { POST } = await import('../route');
    await POST(makeRequest({ chapterId: 'ch1', title: 'STEM Test', template: 'stem' }));
    const rows = sectionInsertSpy.mock.calls[0][0] as Array<Record<string, unknown>>;
    const section5 = rows.find((r) => r.section_order === 5);
    expect(section5?.section_kind).toBe('multi_step_problem');
  });

  it('humanities template uses mini_essay for section 5', async () => {
    testInsertData = { id: 'ct-hum' };
    const { POST } = await import('../route');
    await POST(makeRequest({ chapterId: 'ch1', title: 'Humanities Test', template: 'humanities' }));
    const rows = sectionInsertSpy.mock.calls[0][0] as Array<Record<string, unknown>>;
    const section5 = rows.find((r) => r.section_order === 5);
    expect(section5?.section_kind).toBe('mini_essay');
  });

  it('guardClassAccess is called with the chapter class_id', async () => {
    chapterData = { id: 'ch1', class_id: 'class-special' };
    const { POST } = await import('../route');
    await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));
    expect(guardFn).toHaveBeenCalledWith('class-special');
  });

  // ── after() / generation callback ─────────────────────────────────────────

  it('after() queues generateChapterQuestions with enrolled students + lesson texts', async () => {
    testInsertData = { id: 'ct-gen' };
    enrollmentsData = [{ student_id: 'stu-a' }, { student_id: 'stu-b' }];
    lessonRowsData = [
      { parsed_content: { summary: 'Lesson 1 content' } },
      { parsed_content: { summary: 'Lesson 2 content' } },
    ];
    signalsData = [
      { student_id: 'stu-a', computed: { comprehension_band: 'grade_level', learning_style: 'visual' } },
    ];

    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));

    // Route returns 200 immediately
    expect(res.status).toBe(200);
    expect((await res.json()).chapter_test_id).toBe('ct-gen');

    // Flush microtask queue for after() callback
    await new Promise((r) => setTimeout(r, 0));

    expect(generateChapterQuestionsMock).toHaveBeenCalledOnce();
    const args = generateChapterQuestionsMock.mock.calls[0][0] as {
      chapterTestId: string;
      students: Array<{ studentId: string; comprehension_band: string | null; learning_style: string | null }>;
      lessonTexts: string[];
      template: string;
    };
    expect(args.chapterTestId).toBe('ct-gen');
    expect(args.template).toBe('humanities');

    // Both students included
    expect(args.students).toHaveLength(2);
    const stuA = args.students.find((s) => s.studentId === 'stu-a');
    const stuB = args.students.find((s) => s.studentId === 'stu-b');
    expect(stuA?.comprehension_band).toBe('grade_level');
    expect(stuA?.learning_style).toBe('visual');
    // stu-b has no signal row → null fallbacks
    expect(stuB?.comprehension_band).toBeNull();
    expect(stuB?.learning_style).toBeNull();

    // Both lesson texts serialized
    expect(args.lessonTexts).toHaveLength(2);
    expect(args.lessonTexts[0]).toContain('Lesson 1 content');
    expect(args.lessonTexts[1]).toContain('Lesson 2 content');
  });

  it('after() with no enrolled students marks generation_status=failed without calling generateChapterQuestions', async () => {
    testInsertData = { id: 'ct-empty' };
    enrollmentsData = []; // no students

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('../route');
    await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));

    await new Promise((r) => setTimeout(r, 0));

    expect(generateChapterQuestionsMock).not.toHaveBeenCalled();
    expect(chapterTestUpdateSpy).toHaveBeenCalledWith({ generation_status: 'failed' });
    consoleSpy.mockRestore();
  });

  it('after() handles no lesson texts gracefully (empty lessonTexts array)', async () => {
    testInsertData = { id: 'ct-nolessons' };
    lessonRowsData = []; // no lessons assigned

    const { POST } = await import('../route');
    await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));

    await new Promise((r) => setTimeout(r, 0));

    expect(generateChapterQuestionsMock).toHaveBeenCalledOnce();
    const args = generateChapterQuestionsMock.mock.calls[0][0] as { lessonTexts: string[] };
    expect(args.lessonTexts).toEqual([]);
  });

  it('after() does not throw when generateChapterQuestions throws (fail-soft)', async () => {
    testInsertData = { id: 'ct-throws' };
    generateChapterQuestionsMock.mockRejectedValue(new Error('unexpected engine failure'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ chapterId: 'ch1', title: 'Test', template: 'humanities' }));

    // Route returned 200 before the failure
    expect(res.status).toBe(200);

    // Flush microtask queue
    await new Promise((r) => setTimeout(r, 0));

    // Should log the error, not throw
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[chapter-tests] after() unexpected failure:'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
