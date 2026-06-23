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

    fireEvent.change(screen.getByRole('textbox', { name: /answer for question/i }), { target: { value: 'because photosynthesis' } });
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
    fireEvent.change(screen.getByRole('textbox', { name: /answer for question/i }), { target: { value: 'because photosynthesis' } });
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
    fireEvent.change(screen.getByRole('textbox', { name: /answer for question/i }), { target: { value: 'because photosynthesis' } });
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

describe('AssignmentPlayer — TeliPanel mount (Task 10)', () => {
  it('does NOT show the teli-panel during the read phase', () => {
    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att1"
        content={content}
        initialResponses={{ tasks: {} } as ResponsesShape}
      />,
    );
    // We are still in the read phase — teli-panel must be absent.
    expect(screen.queryByTestId('teli-panel')).not.toBeInTheDocument();
  });

  it('shows the teli-panel once in the tasks phase, without firing any fetch on mount', () => {
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
    // Advance from read → tasks.
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));
    // TeliPanel must now be present.
    expect(screen.getByTestId('teli-panel')).toBeInTheDocument();
    // TeliPanel must NOT have fired any fetch on mount (no network side-effect).
    expect(fetchMock.mock.calls.length).toBe(0);
  });
});

describe('AssignmentPlayer — Teli signal isolation (final-review Fix 2)', () => {
  it('does NOT count keydown/paste that originate inside the Teli panel, but DOES count task-textarea input', async () => {
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

    // A keydown + paste originating inside the Teli panel must be ignored by the
    // assignment's behavioral aggregates (they belong to the tutor chat, not the work).
    const teliTextarea = screen.getByRole('textbox', { name: /ask teli a question/i });
    fireEvent.keyDown(teliTextarea, { key: 'a' });
    fireEvent.keyDown(teliTextarea, { key: 'b' });
    fireEvent.paste(teliTextarea);

    // Now fill + submit. The task textarea must still be the source of real signal.
    const taskTextarea = screen.getByRole('textbox', { name: /answer for question/i });
    // A genuine keydown on the task textarea SHOULD be counted.
    fireEvent.keyDown(taskTextarea, { key: 'z' });
    fireEvent.change(taskTextarea, { target: { value: 'because photosynthesis' } });
    fireEvent.click(screen.getByRole('button', { name: /turn in|submit/i }));

    await waitFor(() => {
      const submitCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/api/attempts/homework-submit'),
      );
      expect(submitCall).toBeDefined();
      const sent = JSON.parse((submitCall![1] as RequestInit).body as string);
      // Teli-originated paste must NOT pollute the paste aggregate.
      expect(sent.sessionAggregates.pasteCount).toBe(0);
      // Only the single task-textarea keydown ('z') is a real keypress; the two Teli
      // keydowns ('a','b') must be excluded.
      expect(sent.sessionAggregates.keypressCount).toBe(1);
    });
  });
});

describe('AssignmentPlayer — image-only answer (Task 6)', () => {
  it('a task answered with only a drawing counts as complete (can advance / submit)', async () => {
    // Single-task assignment where the response has an image_url but no text.
    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att1"
        content={content}
        initialResponses={{ tasks: { '1': { text: '', image_url: '/api/attempts/drawing?path=x' } } } as ResponsesShape}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));
    // The submit button must be ENABLED — an image-only answer is complete.
    const submit = screen.getByRole('button', { name: /turn in|submit/i });
    expect(submit).toBeEnabled();
  });
});

describe('AssignmentPlayer — image-attach autosave (Fix A)', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('persists the image_url to /homework-draft immediately (no timer advance) after a photo file is attached', async () => {
    // Route fetch by URL: POST /api/attempts/drawing returns the proxy URL;
    // PUT /api/attempts/homework-draft (and anything else) returns {}. We record
    // all draft PUT calls to assert immediacy (no fake-timer advance needed).
    const proxyUrl = '/api/attempts/drawing?path=student1/att-img/task-1-1.png';
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/api/attempts/drawing')) {
        return Promise.resolve({ ok: true, json: async () => ({ image_url: proxyUrl }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att-img"
        content={content}
        initialResponses={{ tasks: {} } as ResponsesShape}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));

    // The "Add a photo" file input is visible in the tasks phase when no image is set
    // and the canvas is not open (aria-label="Add a photo" on the hidden <input>).
    const photoInput = screen.getByLabelText(/add a photo/i);
    fireEvent.change(photoInput, {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'p.png', { type: 'image/png' })] },
    });

    // persistDraftNow fires immediately after uploadTaskImage resolves — no timer advance.
    await waitFor(() => {
      const draftCalls = (fetchMock.mock.calls as unknown[][]).filter(
        (args) => typeof args[0] === 'string' && (args[0] as string).includes('/api/attempts/homework-draft'),
      );
      expect(draftCalls.length).toBeGreaterThan(0);
      const lastBody = JSON.parse(
        ((draftCalls[draftCalls.length - 1][1] as unknown as RequestInit).body) as string,
      );
      expect(lastBody.responses.tasks['1'].image_url).toBe(proxyUrl);
    });
  });

  it('persists image_url = null immediately when the attached photo is removed', async () => {
    // Start with an existing image_url so the "Remove" button renders right away
    // in the tasks phase — no upload needed.
    const proxyUrl = '/api/attempts/drawing?path=existing.png';
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({}) }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AssignmentPlayer
        assignmentId="a1"
        attemptId="att-img2"
        content={content}
        initialResponses={{ tasks: { '1': { text: '', image_url: proxyUrl } } } as ResponsesShape}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ready to start|start/i }));

    // "Remove" button is rendered by TaskCard when imageUrl is non-null.
    const removeBtn = screen.getByRole('button', { name: /^remove$/i });
    fireEvent.click(removeBtn);

    // handleTaskImage(step, null) calls persistDraftNow immediately — no timer advance.
    await waitFor(() => {
      const draftCalls = (fetchMock.mock.calls as unknown[][]).filter(
        (args) => typeof args[0] === 'string' && (args[0] as string).includes('/api/attempts/homework-draft'),
      );
      expect(draftCalls.length).toBeGreaterThan(0);
      const lastBody = JSON.parse(
        ((draftCalls[draftCalls.length - 1][1] as unknown as RequestInit).body) as string,
      );
      expect(lastBody.responses.tasks['1'].image_url).toBeNull();
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
    fireEvent.change(screen.getByRole('textbox', { name: /answer for question/i }), { target: { value: 'photosynthesis' } });

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
    expect((screen.getByRole('textbox', { name: /answer for question/i }) as HTMLTextAreaElement).value).toBe('restored draft text');
  });
});
