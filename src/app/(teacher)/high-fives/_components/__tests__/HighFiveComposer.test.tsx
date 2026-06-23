// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HighFiveComposer } from '../HighFiveComposer';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

const suggestions = [{ student_id: 's1', full_name: 'Ann Lee', reason: 'stretch' as const, context_hint: 'Ready for more.' }];
const roster = [
  { student_id: 's1', full_name: 'Ann Lee' },
  { student_id: 's2', full_name: 'Ben Ortiz' },
];
const recent = [
  { student_id: 's2', full_name: 'Ben Ortiz', note_text: 'Loved how you stuck with the hard one.', created_at: '2026-06-21T12:00:00Z' },
];
beforeEach(() => vi.restoreAllMocks());

describe('HighFiveComposer', () => {
  it('lists a suggestion and opens the composer pre-selected on Write a note', () => {
    render(<HighFiveComposer classId="c1" suggestions={suggestions} roster={roster} recent={recent} />);
    // Ann Lee appears in the suggestion card AND as a picker <option>; either presence is fine.
    expect(screen.getAllByText('Ann Lee').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /write a note/i }));
    expect(screen.getByText(/a note for ann lee/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /note text/i })).toBeInTheDocument();
  });

  it('shows 422 violations as role=alert, keeps the draft, and marks the textarea invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/send')
        ? new Response(JSON.stringify({ violations: [{ phrase: 'great job', suggestion: 'Name the specific thing.' }] }), { status: 422 })
        : new Response(JSON.stringify({ draft_text: 'Great job!', source: 'ai' }), { status: 200 }),
    ));
    render(<HighFiveComposer classId="c1" suggestions={suggestions} roster={roster} recent={recent} />);
    fireEvent.click(screen.getByRole('button', { name: /write a note/i }));
    const textbox = screen.getByRole('textbox', { name: /note text/i });
    fireEvent.change(textbox, { target: { value: 'Great job!' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/name the specific thing/i));
    // Draft text survives the 422 so the teacher can revise it.
    expect(screen.getByRole('textbox', { name: /note text/i })).toHaveValue('Great job!');
    expect(screen.getByRole('textbox', { name: /note text/i })).toHaveAttribute('aria-invalid', 'true');
  });

  it('lets a teacher pick any roster student and open a blank composer when there are NO suggestions', () => {
    render(<HighFiveComposer classId="c1" suggestions={[]} roster={roster} recent={recent} />);
    // No suggestion cards, but the picker is available (the dead-end case).
    fireEvent.change(screen.getByRole('combobox', { name: /write a note to someone else/i }), { target: { value: 's2' } });
    fireEvent.click(screen.getByRole('button', { name: /open note/i }));
    expect(screen.getByText(/a note for ben ortiz/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /note text/i })).toBeInTheDocument();
  });

  it('renders a read-only Recent list of sent notes', () => {
    render(<HighFiveComposer classId="c1" suggestions={[]} roster={roster} recent={recent} />);
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText(/loved how you stuck with the hard one/i)).toBeInTheDocument();
    // Ben Ortiz is named in the recent note (and as a picker option).
    expect(screen.getAllByText('Ben Ortiz').length).toBeGreaterThan(0);
  });
});

const adaSuggestions = [{ student_id: 's1', full_name: 'Ada Lovelace', reason: 'persistence' as const, context_hint: 'stuck with it on the hard set' }];

describe('HighFiveComposer — four-beat', () => {
  it('opens the composer with a name heading and Send/Cancel actions', () => {
    render(<HighFiveComposer classId="c1" suggestions={adaSuggestions as never} roster={[] as never} recent={[] as never} />);
    fireEvent.click(screen.getByRole('button', { name: /write a note/i }));
    expect(screen.getByText(/a note for ada lovelace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('settles a calm DEFER line after a successful send', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    render(<HighFiveComposer classId="c1" suggestions={adaSuggestions as never} roster={[] as never} recent={[] as never} />);
    fireEvent.click(screen.getByRole('button', { name: /write a note/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /note text/i }), { target: { value: 'You kept at it.' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await waitFor(() => expect(screen.getByText(/sent to ada lovelace — nice catch\./i)).toBeInTheDocument());
  });
});
