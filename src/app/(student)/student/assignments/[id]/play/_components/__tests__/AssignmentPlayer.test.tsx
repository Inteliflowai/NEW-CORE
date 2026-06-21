// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssignmentPlayer } from '../AssignmentPlayer';
import type { AssignmentContent, ResponsesShape } from '@/lib/assignments/loadAssignmentForPlay';

const content: AssignmentContent = { title: 'X', tasks: [{ step: 1, description: 'Explain X' }] };

const GRADED_BODY = {
  attempt_id: 'att1',
  result: {
    gradePct: 84,
    masteryLabel: 'Strong',
    message: { message: 'Nice!', teliMsg: 'Nice!', teliState: 'idle' as const },
    overallFeedback: 'Good.',
    taskFeedback: [{ step: 1, feedback: 'Clear.' }],
  },
};

function stubFetch(body: unknown = GRADED_BODY) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', stubFetch());
  // jsdom has no localStorage draft by default; nothing to restore.
  if (typeof window !== 'undefined') window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AssignmentPlayer', () => {
  it('moves read → tasks, gates submit until the task has text, then reaches graded', async () => {
    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att1"
        content={content}
        initialResponses={{ tasks: {} } as ResponsesShape}
      />,
    );

    // Read phase first — a Start/Ready CTA moves into the working phase.
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));

    const submit = screen.getByRole('button', { name: /turn in|submit/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'because photosynthesis' } });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    // The grade IS shown (assignments are graded → student sees the number).
    await waitFor(() => expect(screen.getByText('84%')).toBeInTheDocument());
  });

  it('routes to a pending screen when the server delays grading', async () => {
    vi.stubGlobal('fetch', stubFetch({ attempt_id: 'att1', grading_delayed: true, message: 'Saved — grading on its way.' }));
    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att1"
        content={content}
        initialResponses={{ tasks: {} } as ResponsesShape}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'because photosynthesis' } });
    fireEvent.click(screen.getByRole('button', { name: /turn in|submit/i }));
    await waitFor(() => expect(screen.getByText(/grading is on its way|being graded|check back/i)).toBeInTheDocument());
  });

  it('carries sessionAggregates + perTaskMetrics in the submit POST body (8c)', async () => {
    const fetchMock = stubFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att1"
        content={content}
        initialResponses={{ tasks: {} } as ResponsesShape}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'because photosynthesis' } });
    fireEvent.click(screen.getByRole('button', { name: /turn in|submit/i }));

    await waitFor(() => {
      const submitCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/api/attempts/homework-submit'),
      );
      expect(submitCall).toBeDefined();
      const sent = JSON.parse((submitCall![1] as RequestInit).body as string);
      expect(sent.attempt_id).toBe('att1');
      expect(sent.responses.tasks['1'].text).toBe('because photosynthesis');
      expect(sent.sessionAggregates).toBeDefined();
      expect(Array.isArray(sent.perTaskMetrics)).toBe(true);
    });
  });
});

describe('AssignmentPlayer — autosave (8b)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof window !== 'undefined') window.localStorage.clear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fires a debounced PUT /homework-draft with the typed responses after the debounce window', () => {
    const fetchMock = stubFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att1"
        content={content}
        initialResponses={{ tasks: {} } as ResponsesShape}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'photosynthesis' } });

    // Before the debounce window elapses, no draft PUT has fired.
    expect(fetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.includes('/homework-draft'))).toBe(false);

    vi.advanceTimersByTime(3000);

    const draftCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('/api/attempts/homework-draft'),
    );
    expect(draftCall).toBeDefined();
    const init = draftCall![1] as RequestInit;
    expect(init.method).toBe('PUT');
    const sent = JSON.parse(init.body as string);
    expect(sent.attempt_id).toBe('att1');
    expect(sent.responses.tasks['1'].text).toBe('photosynthesis');
  });

  it('restores a newer localStorage draft at mount so the textarea shows the saved text', () => {
    vi.stubGlobal('fetch', stubFetch());
    window.localStorage.setItem(
      'core:assignment-draft:att1',
      JSON.stringify({ responses: { tasks: { '1': { text: 'restored draft text', image_url: null } } }, savedAt: Date.now() }),
    );
    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att1"
        content={content}
        initialResponses={{ tasks: {} } as ResponsesShape}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('restored draft text');
  });
});
