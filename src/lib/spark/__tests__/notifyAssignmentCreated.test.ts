import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const BASE_INPUT = {
  coreHomeworkId: 'hw-1',
  studentId: 'stu-1',
  schoolId: 'sch-1',
  coreClassId: 'cls-1',
  band: 'grade_level' as const,
  learningStyle: 'visual',
  grade: '7',
  subject: 'Science',
  conceptTags: ['photosynthesis'],
  title: 'Energy in Ecosystems',
  content: 'Energy in Ecosystems\n\nExplore how energy flows...',
};

describe('notifyAssignmentCreated', () => {
  beforeEach(() => {
    process.env.SPARK_API_URL = 'https://spark.test';
    process.env.CORE_SPARK_API_SECRET = 'secret-x';
    vi.resetModules();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('POSTs the contract payload with Bearer + idempotency header; maps the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, spark_attempt_id: 'att-9', synthetic_experiment_id: 'exp-9' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { notifyAssignmentCreated } = await import('../notifyAssignmentCreated');

    const result = await notifyAssignmentCreated(BASE_INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://spark.test/api/integration/webhooks/core');
    expect(init.headers.Authorization).toBe('Bearer secret-x');
    expect(init.headers['X-Idempotency-Key']).toBe('hw-1_stu-1');
    const body = JSON.parse(init.body);
    expect(body.event).toBe('spark_assignment_created');
    expect(body.data.core_homework_id).toBe('hw-1');
    expect(body.data.lesson_plan.grade_band).toBe('6-8');
    expect(body.data.lesson_plan.concept_tags).toEqual(['photosynthesis']);
    expect(body.data.student_profile.student_band).toBe('developing');
    expect(body.data.student_profile.locale).toBe('en-US');
    expect(body.data.student_profile.rubric_rolling_averages).toBeUndefined();
    expect(result).toMatchObject({ success: true, sparkAttemptId: 'att-9', syntheticExperimentId: 'exp-9' });
    expect(result.sparkAssignmentId).toBeTruthy();
  });

  it('skips (no fetch) when grade maps to K-2 / unparseable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { notifyAssignmentCreated } = await import('../notifyAssignmentCreated');
    const result = await notifyAssignmentCreated({ ...BASE_INPUT, grade: '1' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, skipped: 'grade_band' });
  });

  it('returns success:false on a non-OK SPARK response (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const { notifyAssignmentCreated } = await import('../notifyAssignmentCreated');
    const result = await notifyAssignmentCreated(BASE_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/500/);
  });

  it('returns success:false on a thrown fetch (network/timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('aborted')));
    const { notifyAssignmentCreated } = await import('../notifyAssignmentCreated');
    const result = await notifyAssignmentCreated(BASE_INPUT);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/aborted/);
  });
});
