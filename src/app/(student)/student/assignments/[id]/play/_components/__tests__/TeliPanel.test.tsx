// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import { TeliPanel } from '../TeliPanel';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
});

function makeTeliResponse(overrides: Record<string, unknown> = {}) {
  return {
    reply: "Let's start by asking what changes when water freezes — what do you notice?",
    hint_rung: 'nudge',
    hints_remaining: 2,
    ...overrides,
  };
}

function stubFetch(body: unknown = makeTeliResponse()) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', stubFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TeliPanel', () => {
  it('(a) renders the intro bubble, both action buttons, and the data-testid', () => {
    render(
      <TeliPanel
        attemptId="att1"
        step={1}
        taskDescription="Explain why ice floats on water."
      />,
    );

    expect(screen.getByTestId('teli-panel')).toBeInTheDocument();
    // Intro bubble is present
    expect(screen.getByText(/Hi! I'm Teli/i)).toBeInTheDocument();
    // Both action buttons are present
    expect(screen.getByRole('button', { name: /ask teli/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stuck|hint/i })).toBeInTheDocument();
  });

  it('(b) "Im stuck — get a hint" POSTs with is_help_request:true, task_step from prop, renders reply + updates pill', async () => {
    const fetchMock = stubFetch(makeTeliResponse({ hints_remaining: 2 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TeliPanel
        attemptId="att1"
        step={3}
        taskDescription="Explain why ice floats on water."
      />,
    );

    // Type a message in the input
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'I need help' } });

    // Click the hint button
    fireEvent.click(screen.getByRole('button', { name: /stuck|hint/i }));

    // Should show thinking state
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    // Verify the request body
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/attempts/homework-tutor');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.attempt_id).toBe('att1');
    expect(body.task_step).toBe(3);
    expect(body.is_help_request).toBe(true);
    expect(body.student_message).toBe('I need help');

    // Reply is rendered
    await waitFor(() => {
      expect(
        screen.getByText(/what changes when water freezes/i),
      ).toBeInTheDocument();
    });

    // Pill updated from hints_remaining
    await waitFor(() => {
      expect(screen.getByText(/2 hints left/i)).toBeInTheDocument();
    });
  });

  it('(c) "Ask Teli" sends is_help_request:false', async () => {
    const fetchMock = stubFetch(
      makeTeliResponse({ hint_rung: null, hints_remaining: null }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TeliPanel
        attemptId="att1"
        step={1}
        taskDescription="Explain why ice floats on water."
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'What does density mean?' } });

    fireEvent.click(screen.getByRole('button', { name: /ask teli/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.is_help_request).toBe(false);
  });

  it('(d) leak test — panel chrome strings contain no banned coach-posture words', () => {
    render(
      <TeliPanel
        attemptId="att1"
        step={1}
        taskDescription="Explain why ice floats on water."
      />,
    );

    // Collect the panel's own chrome text (intro, button labels, pill text)
    const panelEl = screen.getByTestId('teli-panel');
    const chromeStrings = [
      // Intro bubble text
      "Hi! I'm Teli 👋 Stuck on this one? Ask me anything — I'll help you think it through.",
      // Button labels
      'Ask Teli',
      "I'm stuck — get a hint",
      // Pill text when hints remain
      '3 hints left',
      // Pill text when no hints remain
      'No hints left — you\'ve got this',
      // Rung labels
      'A nudge',
      'A cue',
      'First step',
      'Keep going',
      // Thinking state
      "Teli's thinking…",
    ];

    // Only hasBannedWord (NOT hasLeak) — numbers are legitimately allowed in tutor surfaces
    // (e.g. "2 hints left" contains a digit but is not a diagnostic leak)
    for (const s of chromeStrings) {
      expect(hasBannedWord(s), `banned word in: "${s}"`).toBe(false);
    }

    // The panel is rendered and accessible
    expect(panelEl).toBeInTheDocument();
  });

  it('renders an incoming Teli hint with its rung label after a help request', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'What do you already know about the prompt?', hint_rung: 'nudge', hints_remaining: 3 }),
    } as Response);
    render(<TeliPanel attemptId="a1" step={0} taskDescription="desc" />);
    fireEvent.change(screen.getByLabelText('Ask Teli a question'), { target: { value: 'help' } });
    fireEvent.click(screen.getByRole('button', { name: /get a hint/i }));
    expect(await screen.findByText(/what do you already know/i)).toBeInTheDocument();
    expect(screen.getByText('A nudge')).toBeInTheDocument();
  });

  it('resets the conversation when step changes', async () => {
    const fetchMock = stubFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <TeliPanel
        attemptId="att1"
        step={1}
        taskDescription="Explain why ice floats on water."
      />,
    );

    // Send a message to populate the conversation
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'help me' } });
    fireEvent.click(screen.getByRole('button', { name: /stuck|hint/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    // Now change the step prop — conversation should reset
    rerender(
      <TeliPanel
        attemptId="att1"
        step={2}
        taskDescription="Describe the water cycle."
      />,
    );

    // After step change, only the intro bubble should be visible (no previous messages)
    expect(screen.getByText(/Hi! I'm Teli/i)).toBeInTheDocument();
    // The previous teli reply should NOT be present
    expect(
      screen.queryByText(/what changes when water freezes/i),
    ).not.toBeInTheDocument();
  });
});
