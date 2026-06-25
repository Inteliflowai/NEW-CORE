// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LessonLibrary } from '../LessonLibrary';
import type { LessonLibrary as LessonLibraryData } from '@/lib/lessons/loadLessonLibrary';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const NOW = new Date('2026-06-25T12:00:00Z');

function data(): LessonLibraryData {
  return {
    class_id: 'c1',
    lessons: [
      {
        id: 'L1',
        title: 'Photosynthesis',
        subject: 'Science',
        grade_level: '7',
        status: 'pending_review',
        quiz_count: 1,
        created_at: '2026-06-25T08:00:00Z',
        standard_codes: [],
        standard_framework: null,
        chapter_title: null,
        day_index: null,
        parsed_content: {
          objectives: ['Explain photosynthesis'],
          key_concepts: ['chlorophyll'],
          vocabulary: [],
          misconception_risks: [],
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
  );
});

describe('LessonLibrary — Publish to Classroom (gated on googleCourseId)', () => {
  it('shows "Publish to Classroom" on the lesson row when googleCourseId is set', () => {
    render(
      <LessonLibrary
        data={data()}
        now={NOW}
        googleCourseId="gc-course-123"
      />,
    );
    expect(
      screen.getByRole('button', { name: /publish to classroom — Photosynthesis/i }),
    ).toBeInTheDocument();
  });

  it('does NOT show "Publish to Classroom" when googleCourseId is null', () => {
    render(<LessonLibrary data={data()} now={NOW} googleCourseId={null} />);
    expect(
      screen.queryByRole('button', { name: /publish to classroom/i }),
    ).toBeNull();
  });

  it('does NOT show "Publish to Classroom" when googleCourseId is omitted', () => {
    render(<LessonLibrary data={data()} now={NOW} />);
    expect(
      screen.queryByRole('button', { name: /publish to classroom/i }),
    ).toBeNull();
  });

  it('clicking "Publish to Classroom" POSTs classId, resourceType:assignment, resourceId:lessonId', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LessonLibrary
        data={data()}
        now={NOW}
        googleCourseId="gc-course-123"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /publish to classroom — Photosynthesis/i }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/teacher/google/publish');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      classId: 'c1',
      resourceType: 'assignment',
      resourceId: 'L1',
    });
  });

  it('shows a quiet success state after publishing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );

    render(
      <LessonLibrary
        data={data()}
        now={NOW}
        googleCourseId="gc-course-123"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /publish to classroom — Photosynthesis/i }),
    );

    await waitFor(() => expect(screen.getByText(/sent to classroom/i)).toBeInTheDocument());
  });

  it('shows a "Reconnect Google" link when needsReconnect:true is returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ needsReconnect: true }),
      }),
    );

    render(
      <LessonLibrary
        data={data()}
        now={NOW}
        googleCourseId="gc-course-123"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /publish to classroom — Photosynthesis/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /reconnect google/i })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('link', { name: /reconnect google/i }),
    ).toHaveAttribute('href', '/settings/google');
  });

  // M3-fix: gcErrorResponse returns HTTP 200 {connected:false} — must show Reconnect, NOT "Sent to Classroom"
  it('shows a "Reconnect Google" link when {connected:false} is returned at HTTP 200 (M3-fix)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true, // HTTP 200 — the old branch on !res.ok would have missed this
        json: async () => ({ connected: false }),
      }),
    );

    render(
      <LessonLibrary
        data={data()}
        now={NOW}
        googleCourseId="gc-course-123"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /publish to classroom — Photosynthesis/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /reconnect google/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/sent to classroom/i)).toBeNull();
  });

  // plain failure: non-ok with no reconnect fields → button stays (idle), NOT "Sent to Classroom"
  it('stays idle (button visible) on a plain non-ok failure with no reconnect fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'something went wrong' }),
      }),
    );

    render(
      <LessonLibrary
        data={data()}
        now={NOW}
        googleCourseId="gc-course-123"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /publish to classroom — Photosynthesis/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /publish to classroom — Photosynthesis/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/sent to classroom/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /reconnect google/i })).toBeNull();
  });
});
