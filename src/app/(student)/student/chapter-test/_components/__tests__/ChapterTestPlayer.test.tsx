// @vitest-environment jsdom
import '@/test/setup-dom';

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ── Mock sub-components that have side-effects (timers, polling) ──────────────

/**
 * ChapterTestTimer is mocked to:
 * - Avoid real setInterval in jsdom
 * - Expose a "trigger time up" button so tests can fire onTimeUp
 */
vi.mock('../ChapterTestTimer', () => ({
  ChapterTestTimer: ({
    onTimeUp,
  }: {
    startedAt: string;
    totalMinutes: number;
    onTimeUp: () => void;
  }) => (
    <button data-testid="timer-time-up" type="button" onClick={onTimeUp}>
      Timer (44 min)
    </button>
  ),
}));

/**
 * ChapterTestResultScreen is mocked to:
 * - Avoid polling setInterval in jsdom
 * - Provide a stable testid for assertions
 */
vi.mock('../ChapterTestResultScreen', () => ({
  ChapterTestResultScreen: ({ attemptId }: { attemptId: string }) => (
    <div data-testid="result-screen" data-attempt-id={attemptId}>
      Result screen
    </div>
  ),
}));

// Import the component under test AFTER mocks are declared
import { ChapterTestPlayer } from '../ChapterTestPlayer';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SECTION_1 = {
  id: 'sec-1',
  section_order: 1,
  section_kind: 'comprehension',
  title: 'Reading Comprehension',
  time_minutes: 9,
  total_points: 12,
  power_skill: null,
  questions: [
    {
      id: 'q-1',
      question_order: 1,
      question_type: 'short_answer',
      question_text: 'What is the main theme?',
      payload: {},
      points: 4,
    },
  ],
};

const SECTION_2 = {
  id: 'sec-2',
  section_order: 2,
  section_kind: 'vocabulary',
  title: 'Vocabulary',
  time_minutes: 8,
  total_points: 12,
  power_skill: null,
  questions: [
    {
      id: 'q-2',
      question_order: 1,
      question_type: 'short_answer',
      question_text: 'Define the word "ephemeral".',
      payload: {},
      points: 3,
    },
  ],
};

const START_SUCCESS = {
  attempt_id: 'attempt-1',
  status: 'in_progress',
  started_at: '2026-06-26T10:00:00.000Z',
  elapsed_seconds: 0,
  sections: [SECTION_1, SECTION_2],
  existing_responses: [],
};

const START_FORFEITED = {
  forfeited: true,
  attempt_id: 'attempt-1',
};

const SUBMIT_SUCCESS = { ok: true, attempt_id: 'attempt-1' };

/** Build a fetch mock that dispatches by URL. */
function makeFetch(
  startBody: object = START_SUCCESS,
  submitBody: object = SUBMIT_SUCCESS,
) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/start')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(startBody),
      });
    }
    if (url.includes('/submit')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(submitBody),
      });
    }
    // save-response (autosave)
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ChapterTestPlayer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFetch());
    vi.stubGlobal('confirm', () => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── 1. Loading state ────────────────────────────────────────────────────────

  it('shows loading spinner on mount before start resolves', () => {
    // Fetch that never resolves keeps component in loading state
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<ChapterTestPlayer chapterTestId="ct-1" userId="student-1" />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  // ── 2. Transitions to taking state ──────────────────────────────────────────

  it('transitions to taking state after successful start, showing section tabs and first question', async () => {
    render(<ChapterTestPlayer chapterTestId="ct-1" userId="student-1" />);

    // Section tabs appear
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /reading comprehension/i })).toBeTruthy();
    });

    // Second tab is also visible
    expect(screen.getByRole('tab', { name: /vocabulary/i })).toBeTruthy();

    // First section's question is shown
    expect(screen.getByText('What is the main theme?')).toBeTruthy();
  });

  // ── 3. Section tab navigation ───────────────────────────────────────────────

  it('clicking tab 2 switches the active section', async () => {
    render(<ChapterTestPlayer chapterTestId="ct-1" userId="student-1" />);

    await waitFor(() =>
      screen.getByRole('tab', { name: /vocabulary/i }),
    );

    // Section 1 question is visible initially
    expect(screen.getByText('What is the main theme?')).toBeTruthy();
    // Section 2 question is NOT visible yet
    expect(screen.queryByText(/define the word/i)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /vocabulary/i }));

    // Section 2 question now shows
    expect(screen.getByText(/define the word/i)).toBeTruthy();
    // Section 1 question is gone
    expect(screen.queryByText('What is the main theme?')).toBeNull();
  });

  // ── 4. Submit button — confirm dialog + POST ────────────────────────────────

  it('submit button triggers confirm dialog then POSTs submit', async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);

    render(<ChapterTestPlayer chapterTestId="ct-1" userId="student-1" />);
    await waitFor(() => screen.getByRole('button', { name: /submit test/i }));

    fireEvent.click(screen.getByRole('button', { name: /submit test/i }));

    // confirm() must have been called
    expect(confirmMock).toHaveBeenCalledOnce();

    // submit endpoint must have been called
    await waitFor(() => {
      const calls = fetchMock.mock.calls as [string, RequestInit][];
      const submitCall = calls.find(([url]) => url.includes('/submit'));
      expect(submitCall).toBeTruthy();
    });
  });

  it('cancel in confirm dialog does NOT submit', async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', () => false); // cancel

    render(<ChapterTestPlayer chapterTestId="ct-1" userId="student-1" />);
    await waitFor(() => screen.getByRole('button', { name: /submit test/i }));

    fireEvent.click(screen.getByRole('button', { name: /submit test/i }));

    // submit endpoint should NOT have been called
    await act(async () => {});
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    const submitCall = calls.find(([url]) => url.includes('/submit'));
    expect(submitCall).toBeUndefined();
  });

  // ── 5. onTimeUp → forfeit submit ────────────────────────────────────────────

  it('onTimeUp triggers submit with forfeit_reason: time_up', async () => {
    const fetchMock = makeFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<ChapterTestPlayer chapterTestId="ct-1" userId="student-1" />);
    await waitFor(() => screen.getByTestId('timer-time-up'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('timer-time-up'));
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls as [string, RequestInit][];
      const submitCall = calls.find(([url]) => url.includes('/submit'));
      expect(submitCall).toBeTruthy();
      const body = JSON.parse(submitCall![1].body as string) as {
        forfeit_reason: string | null;
      };
      expect(body.forfeit_reason).toBe('time_up');
    });
  });

  // ── 6. Transitions to result state after submit ─────────────────────────────

  it('transitions to result state after submit completes', async () => {
    render(<ChapterTestPlayer chapterTestId="ct-1" userId="student-1" />);
    await waitFor(() => screen.getByRole('button', { name: /submit test/i }));

    fireEvent.click(screen.getByRole('button', { name: /submit test/i }));

    await waitFor(() => {
      expect(screen.getByTestId('result-screen')).toBeTruthy();
    });
  });

  // ── 7. Forfeited: jump straight to result ───────────────────────────────────

  it('jumps directly to result state if start returns forfeited: true', async () => {
    vi.stubGlobal('fetch', makeFetch(START_FORFEITED));

    render(<ChapterTestPlayer chapterTestId="ct-1" userId="student-1" />);

    // Result screen should appear without going through taking state
    await waitFor(() => {
      expect(screen.getByTestId('result-screen')).toBeTruthy();
    });

    // No section tabs should be visible
    expect(screen.queryByRole('tab')).toBeNull();
  });

  // ── Extra: recovery banner ──────────────────────────────────────────────────

  it('shows recovery banner when existing_responses are present (resuming)', async () => {
    const startWithResponses = {
      ...START_SUCCESS,
      existing_responses: [
        {
          question_id: 'q-1',
          response_text: 'Previously saved answer',
          response_payload: {},
        },
      ],
    };
    vi.stubGlobal('fetch', makeFetch(startWithResponses));

    render(<ChapterTestPlayer chapterTestId="ct-1" userId="student-1" />);

    await waitFor(() => {
      expect(screen.getByText(/continuing your test/i)).toBeTruthy();
    });
  });

  it('restores existing responses from prior session', async () => {
    const startWithResponses = {
      ...START_SUCCESS,
      existing_responses: [
        {
          question_id: 'q-1',
          response_text: 'Previously saved answer',
          response_payload: {},
        },
      ],
    };
    vi.stubGlobal('fetch', makeFetch(startWithResponses));

    render(<ChapterTestPlayer chapterTestId="ct-1" userId="student-1" />);

    await waitFor(() => screen.getByRole('tab', { name: /reading comprehension/i }));

    // The textarea should be prefilled with the existing response
    const textarea = screen.getByRole('textbox', { name: /answer/i }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Previously saved answer');
  });
});
