// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HighFiveComposer } from '../HighFiveComposer';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const suggestions = [{ student_id: 's1', full_name: 'Ann Lee', reason: 'stretch' as const, context_hint: 'Ready for more.' }];
beforeEach(() => vi.restoreAllMocks());

describe('HighFiveComposer', () => {
  it('lists a suggestion and opens the composer pre-selected on Write a note', () => {
    render(<HighFiveComposer classId="c1" suggestions={suggestions} />);
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /write a note/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
  it('shows 422 violations inline and does not clear the draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/send')
        ? new Response(JSON.stringify({ violations: [{ phrase: 'great job', suggestion: 'Name the specific thing.' }] }), { status: 422 })
        : new Response(JSON.stringify({ draft_text: 'Great job!', source: 'ai' }), { status: 200 }),
    ));
    render(<HighFiveComposer classId="c1" suggestions={suggestions} />);
    fireEvent.click(screen.getByRole('button', { name: /write a note/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Great job!' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await waitFor(() => expect(screen.getByText(/name the specific thing/i)).toBeInTheDocument());
  });
});
