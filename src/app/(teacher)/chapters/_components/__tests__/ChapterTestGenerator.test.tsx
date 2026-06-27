// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import { ChapterTestGenerator } from '../ChapterTestGenerator';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const NO_TEST_PROPS = {
  chapterId: 'ch1',
  chapterTitle: 'Unit 3: The Civil War',
  existingTest: null,
};

const QUEUED_TEST = {
  id: 'ct1',
  title: 'Unit 3 Chapter Test',
  status: 'draft' as const,
  generation_status: 'queued' as const,
};

const GENERATING_TEST = {
  id: 'ct1',
  title: 'Unit 3 Chapter Test',
  status: 'draft' as const,
  generation_status: 'generating' as const,
};

const READY_TEST = {
  id: 'ct1',
  title: 'Unit 3 Chapter Test',
  status: 'draft' as const,
  generation_status: 'ready' as const,
};

const PUBLISHED_TEST = {
  id: 'ct1',
  title: 'Unit 3 Chapter Test',
  status: 'published' as const,
  generation_status: 'ready' as const,
};

const FAILED_TEST = {
  id: 'ct1',
  title: 'Unit 3 Chapter Test',
  status: 'draft' as const,
  generation_status: 'failed' as const,
};

const ARCHIVED_TEST = {
  id: 'ct1',
  title: 'Unit 3 Chapter Test',
  status: 'archived' as const,
  generation_status: 'ready' as const,
};

/** Minimal GET response returned by the poll endpoint */
const POLL_GENERATING_RESPONSE = {
  generation_status: 'generating',
  status: 'draft',
  total_minutes: 44,
  total_points: 60,
  sections: [
    { section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary', question_counts: { total: 5 } },
    { section_order: 2, section_kind: 'short_answer', title: 'Short Answer', question_counts: { total: 3 } },
  ],
};

const POLL_READY_RESPONSE = {
  generation_status: 'ready',
  status: 'draft',
  total_minutes: 44,
  total_points: 60,
  sections: [
    { section_order: 1, section_kind: 'vocabulary', title: 'Vocabulary', question_counts: { total: 25 } },
  ],
};

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  // Default fetch: POST create → { chapter_test_id }; GET poll → generating
  vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
    const method = opts?.method ?? 'GET';
    if (method === 'POST' && String(url).includes('/api/teacher/chapter-tests')) {
      return { ok: true, json: async () => ({ chapter_test_id: 'ct1' }) };
    }
    if (method === 'PATCH') {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    // GET poll
    return { ok: true, json: async () => POLL_GENERATING_RESPONSE };
  }));
});

// ── Idle / form state ──────────────────────────────────────────────────────────

describe('ChapterTestGenerator — idle state (no existing test)', () => {
  it('renders "Create Chapter Test" button when no existing test', () => {
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    expect(screen.getByRole('button', { name: /create chapter test/i })).toBeInTheDocument();
  });

  it('does NOT show the form initially', () => {
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    expect(screen.queryByLabelText(/test title/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/template/i)).not.toBeInTheDocument();
  });

  it('shows form with title + template selector after clicking "Create Chapter Test"', () => {
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /create chapter test/i }));
    expect(screen.getByLabelText(/test title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/template/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate test/i })).toBeInTheDocument();
  });

  it('pre-fills title with chapterTitle', () => {
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /create chapter test/i }));
    expect(screen.getByLabelText(/test title/i)).toHaveValue('Unit 3: The Civil War');
  });

  it('template selector defaults to Humanities', () => {
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /create chapter test/i }));
    const select = screen.getByLabelText(/template/i) as HTMLSelectElement;
    expect(select.value).toBe('humanities');
  });

  it('template selector includes STEM option', () => {
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /create chapter test/i }));
    const select = screen.getByLabelText(/template/i);
    expect(select).toBeInTheDocument();
    // Check both options exist
    expect(screen.getByRole('option', { name: /humanities/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /stem/i })).toBeInTheDocument();
  });

  it('Cancel button collapses the form', () => {
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /create chapter test/i }));
    expect(screen.getByLabelText(/test title/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByLabelText(/test title/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create chapter test/i })).toBeInTheDocument();
  });
});

// ── Form submit → generating ───────────────────────────────────────────────────

describe('ChapterTestGenerator — form submission', () => {
  it('submits POST /api/teacher/chapter-tests on "Generate Test" click', async () => {
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /create chapter test/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate test/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/teacher/chapter-tests',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('POST body includes chapterId, title, and template', async () => {
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /create chapter test/i }));
    // Change template to STEM
    fireEvent.change(screen.getByLabelText(/template/i), { target: { value: 'stem' } });
    fireEvent.click(screen.getByRole('button', { name: /generate test/i }));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit?]>;
      const postCall = calls.find(([, opts]) => opts?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1]!.body as string) as Record<string, unknown>;
      expect(body.chapterId).toBe('ch1');
      expect(body.title).toBe('Unit 3: The Civil War');
      expect(body.template).toBe('stem');
    });
  });

  it('transitions to generating state (spinner visible) after successful POST', async () => {
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /create chapter test/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate test/i }));

    await waitFor(() => {
      expect(screen.getByText(/building test/i)).toBeInTheDocument();
    });
  });

  it('shows an error and stays on the form when POST fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Chapter not found' }),
    }));
    render(<ChapterTestGenerator {...NO_TEST_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /create chapter test/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate test/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/chapter not found/i);
    });
    // Form should still be visible
    expect(screen.getByRole('button', { name: /generate test/i })).toBeInTheDocument();
  });
});

// ── Generating state (from existingTest prop) ──────────────────────────────────

describe('ChapterTestGenerator — generating state (existingTest prop)', () => {
  it('shows spinner/building UI when generation_status is queued', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={QUEUED_TEST}
      />,
    );
    expect(screen.getByText(/building test/i)).toBeInTheDocument();
  });

  it('shows spinner/building UI when generation_status is generating', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={GENERATING_TEST}
      />,
    );
    expect(screen.getByText(/building test/i)).toBeInTheDocument();
  });
});

// ── Polling — section progress ─────────────────────────────────────────────────

describe('ChapterTestGenerator — polling (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls GET /api/teacher/chapter-tests/[id] every 3s while generating', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => POLL_GENERATING_RESPONSE,
    }));

    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={QUEUED_TEST}
      />,
    );

    // Advance past the 3s interval — advanceTimersByTimeAsync also drains microtasks
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3001);
    });

    // Component calls fetch(url) with no init object when polling
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const pollCall = calls.find((c) =>
      typeof c[0] === 'string' &&
      (c[0] as string).includes(`/api/teacher/chapter-tests/${QUEUED_TEST.id}`),
    );
    expect(pollCall).toBeDefined();
  });

  it('displays per-section progress from poll response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => POLL_GENERATING_RESPONSE,
    }));

    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={QUEUED_TEST}
      />,
    );

    // Advance and drain microtasks so the component re-renders with section data
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3001);
    });
    // Extra tick to flush any remaining React state updates
    await act(async () => {});

    // Sections with counts > 0 should show "N students ready"
    expect(screen.getByText(/5 students ready/i)).toBeInTheDocument();
    expect(screen.getByText(/3 students ready/i)).toBeInTheDocument();
  });

  it('transitions to ready state when poll returns generation_status=ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => POLL_READY_RESPONSE,
    }));

    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={QUEUED_TEST}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3001);
    });
    await act(async () => {});

    expect(screen.getByText(/questions ready/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
  });

  it('transitions to failed state when poll returns generation_status=failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...POLL_GENERATING_RESPONSE, generation_status: 'failed' }),
    }));

    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={QUEUED_TEST}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3001);
    });
    await act(async () => {});

    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('clears the interval on unmount (no memory leak)', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => POLL_GENERATING_RESPONSE,
    }));

    const { unmount } = render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={QUEUED_TEST}
      />,
    );

    unmount();

    // clearInterval must have been called with a non-null value (the interval ID)
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});

// ── Ready state ────────────────────────────────────────────────────────────────

describe('ChapterTestGenerator — ready state (existingTest prop)', () => {
  it('shows "✓ Questions ready" and Publish button when generation_status is ready', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={READY_TEST}
      />,
    );
    expect(screen.getByText(/questions ready/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
  });

  it('Publish button calls PATCH /api/teacher/chapter-tests/[id] with action=publish', async () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={READY_TEST}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /publish/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/teacher/chapter-tests/${READY_TEST.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ action: 'publish' }),
        }),
      );
    });
  });

  it('transitions to published state after successful Publish', async () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={READY_TEST}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /publish/i }));

    await waitFor(() => {
      expect(screen.getByText(/✓ published/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  it('shows an error when Publish API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Test is still generating' }),
    }));
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={READY_TEST}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /publish/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/still generating/i);
    });
    // Publish button should still be visible for retry
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
  });
});

// ── Published state ────────────────────────────────────────────────────────────

describe('ChapterTestGenerator — published state (existingTest prop)', () => {
  it('shows "✓ Published" badge when status is published', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={PUBLISHED_TEST}
      />,
    );
    expect(screen.getByText(/✓ published/i)).toBeInTheDocument();
  });

  it('does NOT show Publish button when already published', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={PUBLISHED_TEST}
      />,
    );
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  it('does NOT show "Create Chapter Test" button when already published', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={PUBLISHED_TEST}
      />,
    );
    expect(screen.queryByRole('button', { name: /create chapter test/i })).not.toBeInTheDocument();
  });
});

// ── Failed state ───────────────────────────────────────────────────────────────

describe('ChapterTestGenerator — failed state (existingTest prop)', () => {
  it('shows an error message when generation_status is failed', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={FAILED_TEST}
      />,
    );
    // A descriptive error message must be visible (not just the button)
    expect(screen.getByText(/something went wrong|generation failed|test generation failed/i)).toBeInTheDocument();
  });

  it('shows "Try again" button when generation_status is failed', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={FAILED_TEST}
      />,
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('"Try again" button resets to the form', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={FAILED_TEST}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    // Should now show the form
    expect(screen.getByRole('button', { name: /generate test/i })).toBeInTheDocument();
  });
});

// ── Archived state ─────────────────────────────────────────────────────────────

describe('ChapterTestGenerator — archived state', () => {
  it('shows "Archived" state when status is archived', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={ARCHIVED_TEST}
      />,
    );
    expect(screen.getByText(/archived/i)).toBeInTheDocument();
  });

  it('shows no action buttons in archived state', () => {
    render(
      <ChapterTestGenerator
        chapterId="ch1"
        chapterTitle="Unit 3"
        existingTest={ARCHIVED_TEST}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
