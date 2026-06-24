// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GenerateLessonStudio from '../GenerateLessonStudio';

let lastBody: Record<string, unknown> | null;
beforeEach(() => {
  lastBody = null;
  globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : null;
    return new Response(JSON.stringify({
      chapter_title: null, framework: 'TEKS',
      days: [{ lesson_id: 'L1', day_index: null, title: 'Fractions', subject: 'Math', grade_level: '4',
        standard_framework: 'TEKS', parsed_content: { title: 'Fractions', summary: 's', objectives: [], key_concepts: [], vocabulary: [], misconception_risks: [], proposed_standards: [] } }],
    }), { status: 200 });
  }) as unknown as typeof fetch;
});

describe('GenerateLessonStudio', () => {
  it('requires a description (button disabled until typed)', () => {
    render(<GenerateLessonStudio classId="c1" schoolState={null} />);
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
  });
  it('defaults the state select to the school state', () => {
    render(<GenerateLessonStudio classId="c1" schoolState="TX" />);
    expect((screen.getByLabelText(/state/i) as HTMLSelectElement).value).toBe('TX');
  });
  it('submits the description + class_id + state and then shows the review editor', async () => {
    render(<GenerateLessonStudio classId="c1" schoolState="TX" />);
    fireEvent.change(screen.getByLabelText(/describe|what.*teach|lesson/i), { target: { value: 'Teach adding fractions' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /make quiz/i })).toBeInTheDocument());
    expect(lastBody).toMatchObject({ description: 'Teach adding fractions', class_id: 'c1', state: 'TX' });
  });
  it('shows an error message when generate fails', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { userMessage: 'The system is busy — please try again in a moment.' } }), { status: 503 })) as unknown as typeof fetch;
    render(<GenerateLessonStudio classId="c1" schoolState={null} />);
    fireEvent.change(screen.getByLabelText(/describe|what.*teach|lesson/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/busy/i));
  });

  it('dictation appends the transcript to the description', async () => {
    let rec: { state: string; ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void } = { state: 'inactive' };
    class FakeRec { state = 'inactive'; ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null;
      constructor() { rec = this as never; } start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) }); this.onstop?.(); }
      static isTypeSupported() { return true; } }
    (globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) };
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRec;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ transcript: 'photosynthesis basics' }), { status: 200 })) as unknown as typeof fetch;

    render(<GenerateLessonStudio classId="c1" schoolState={null} />);
    fireEvent.click(screen.getByRole('button', { name: /dictate/i }));
    await waitFor(() => expect(rec.state).toBe('recording'));
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect((screen.getByLabelText(/describe what to teach/i) as HTMLTextAreaElement).value).toMatch(/photosynthesis basics/));
  });
});
