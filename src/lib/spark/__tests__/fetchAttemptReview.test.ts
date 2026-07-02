import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAttemptReview } from '@/lib/spark/fetchAttemptReview';

const WIRE = {
  attempt: { state: 'completed', started_at: 's', completed_at: 'c', score: 80,
             effort_label: 'effortful_success', revision_count: 1, teli_hint_count: 0 },
  generation_status: 'ready',
  steps: [{ order: 1, title: 'The Challenge', type: 'instruction', description: 'd' }],
  step_responses: [{ step_index: 0, type: 'instruction', value: { acknowledged: true }, completed: true }],
  analysis: { rubric_dimensions: { creativity: 4 }, dimension_observations: null,
              key_observations: ['x'], content_quality: 'engaged' },
};

describe('fetchAttemptReview', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs the action with the per-school key and maps to camelCase', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(WIRE), { status: 200 }));
    const res = await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'hw', coreStudentId: 'st' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.review.attempt.effortLabel).toBe('effortful_success');
    expect(res.review.steps?.[0].title).toBe('The Challenge');
    expect(res.review.stepResponses).toHaveLength(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/api/integration/core');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toMatchObject({
      action: 'get_attempt_review', core_homework_id: 'hw', core_student_id: 'st' });
  });

  it('maps 404 to not_found', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'No attempt found for this assignment' }), { status: 404 }));
    expect(await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' }))
      .toEqual({ ok: false, reason: 'not_found' });
  });

  it('maps network failure to unreachable', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' }))
      .toEqual({ ok: false, reason: 'unreachable' });
  });

  it('maps a 5xx to unreachable (never a bogus empty review)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Integration request failed' }), { status: 500 }));
    expect(await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' }))
      .toEqual({ ok: false, reason: 'unreachable' });
  });

  it('maps a non-JSON 200 body to unreachable', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('<html>gateway</html>', { status: 200 }));
    expect(await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' }))
      .toEqual({ ok: false, reason: 'unreachable' });
  });

  it('tolerates malformed wire payloads (defensive defaults, never throws)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({
        attempt: { state: 'completed' },
        steps: 'garbage',
        analysis: {
          dimension_observations: { creativity: { nested: true }, reflection: 'real prose' },
          rubric_dimensions: { creativity: 'four', reflection: 3 },
        },
      }), { status: 200 }));
    const res = await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.review.steps).toBeNull();
    expect(res.review.stepResponses).toEqual([]);
    // value-level filtering: non-string observations and non-number rubric entries dropped
    expect(res.review.analysis?.dimension_observations).toEqual({ reflection: 'real prose' });
    expect(res.review.analysis?.rubric_dimensions).toEqual({ reflection: 3 });
  });

  it('mapSteps is all-or-nothing: one malformed element invalidates the WHOLE steps array', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({
        attempt: { state: 'completed' },
        steps: [
          { order: 1, title: 'The Challenge', type: 'instruction', description: 'd' },
          { order: 2, title: 'Bad Step' /* missing type */ },
        ],
      }), { status: 200 }));
    const res = await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // NOT [{ order: 1, ... }] (dropping the bad element and shifting positions) — null,
    // so the panel degrades to safe "Step N" fallback labels instead of a positionally
    // mislabeled title.
    expect(res.review.steps).toBeNull();
  });
});
