// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QuizLibrary } from '../QuizLibrary';
import type { QuizLibrary as QuizLibraryData } from '@/lib/quizzes/loadQuizLibrary';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const FIXED_NOW = new Date('2026-06-25T12:00:00.000Z');

function data(): QuizLibraryData {
  return {
    class_id: 'c1',
    quizzes: [
      {
        id: 'q1',
        title: 'Cells — Check',
        lesson_title: 'Cell Structure',
        subject: 'Science',
        grade_level: '8',
        status: 'draft',
        question_count: 5,
        published_at: null,
        created_at: '2026-06-20T00:00:00Z',
      },
    ],
  };
}

beforeEach(() => {
  refresh.mockReset();
  vi.restoreAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
  );
});

describe('QuizLibrary — Publish to Classroom (gated on googleCourseId)', () => {
  it('shows "Publish to Classroom" on the row when googleCourseId is set', () => {
    render(
      <QuizLibrary
        data={data()}
        classId="c1"
        now={FIXED_NOW}
        googleCourseId="gc-course-123"
      />,
    );
    // The button should appear on the quiz row (not inside the edit panel)
    expect(screen.getByRole('button', { name: /publish to classroom/i })).toBeInTheDocument();
  });

  it('does NOT show "Publish to Classroom" when googleCourseId is null', () => {
    render(
      <QuizLibrary
        data={data()}
        classId="c1"
        now={FIXED_NOW}
        googleCourseId={null}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /publish to classroom/i }),
    ).toBeNull();
  });

  it('does NOT show "Publish to Classroom" when googleCourseId is omitted', () => {
    render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} />);
    expect(
      screen.queryByRole('button', { name: /publish to classroom/i }),
    ).toBeNull();
  });

  it('clicking "Publish to Classroom" POSTs classId, resourceType:quiz, resourceId to the publish route', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QuizLibrary
        data={data()}
        classId="c1"
        now={FIXED_NOW}
        googleCourseId="gc-course-123"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /publish to classroom/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/teacher/google/publish');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      classId: 'c1',
      resourceType: 'quiz',
      resourceId: 'q1',
    });
  });

  it('shows a quiet success state after publishing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );

    render(
      <QuizLibrary
        data={data()}
        classId="c1"
        now={FIXED_NOW}
        googleCourseId="gc-course-123"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /publish to classroom/i }));

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
      <QuizLibrary
        data={data()}
        classId="c1"
        now={FIXED_NOW}
        googleCourseId="gc-course-123"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /publish to classroom/i }));

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
      <QuizLibrary
        data={data()}
        classId="c1"
        now={FIXED_NOW}
        googleCourseId="gc-course-123"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /publish to classroom/i }));

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
      <QuizLibrary
        data={data()}
        classId="c1"
        now={FIXED_NOW}
        googleCourseId="gc-course-123"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /publish to classroom/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /publish to classroom/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/sent to classroom/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /reconnect google/i })).toBeNull();
  });
});
