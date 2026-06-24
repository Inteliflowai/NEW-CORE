// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LessonReviewEditor, { type GeneratedDay } from '../LessonReviewEditor';

function day(over: Partial<GeneratedDay> = {}): GeneratedDay {
  return {
    lesson_id: 'L1', day_index: null, title: 'Fractions', subject: 'Math', grade_level: '4',
    standard_framework: 'TEKS',
    parsed_content: {
      title: 'Fractions', summary: 'Passage.', objectives: ['Add fractions'],
      key_concepts: ['numerator'], vocabulary: [{ term: 'fraction', definition: 'part of a whole' }],
      misconception_risks: ['bigger = more'], grade_level: '4', subject: 'Math',
      proposed_standards: [{ code: 'TEKS.4.3A', description: 'Represent fractions' }],
    },
    ...over,
  };
}

const calls: Array<{ url: string; body: unknown }> = [];
beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url: String(url), body });
    if (String(url).includes('/manage')) return new Response(JSON.stringify({ ok: true, lesson_id: body.lesson_id }), { status: 200 });
    return new Response(JSON.stringify({ quiz_id: 'Q1' }), { status: 200 });
  }) as unknown as typeof fetch;
});

describe('LessonReviewEditor', () => {
  it('renders the generated content into editable fields + shows proposed standards', () => {
    render(<LessonReviewEditor days={[day()]} chapterTitle={null} framework="TEKS" classId="c1" />);
    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe('Fractions');
    expect((screen.getByLabelText(/passage|summary/i) as HTMLTextAreaElement).value).toContain('Passage');
    expect(screen.getByText(/TEKS\.4\.3A/)).toBeInTheDocument();
  });

  it('save edits → calls manage edit then quizzes generate; proposed standards default-checked persist', async () => {
    render(<LessonReviewEditor days={[day()]} chapterTitle={null} framework="TEKS" classId="c1" />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Fractions Day 1' } });
    // AI-proposed standards default to CHECKED (opt-out confirm) — a straight save persists them.
    expect((screen.getByLabelText(/TEKS\.4\.3A/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /make quiz/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/quizzes/generate'))).toBe(true));
    const edit = calls.find((c) => c.url.includes('/manage'))!;
    expect((edit.body as { title: string }).title).toBe('Fractions Day 1');
    expect((edit.body as { standard_codes: string[] }).standard_codes).toEqual(['TEKS.4.3A']);
    expect((edit.body as { action: string }).action).toBe('edit');
    const gen = calls.find((c) => c.url.includes('/quizzes/generate'))!;
    expect((gen.body as { lesson_id: string }).lesson_id).toBe('L1');
  });

  it('unchecking a proposed standard then saving persists no standard codes', async () => {
    render(<LessonReviewEditor days={[day()]} chapterTitle={null} framework="TEKS" classId="c1" />);
    // Uncheck the default-checked proposal to drop it.
    fireEvent.click(screen.getByLabelText(/TEKS\.4\.3A/));
    expect((screen.getByLabelText(/TEKS\.4\.3A/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /make quiz/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/quizzes/generate'))).toBe(true));
    const edit = calls.find((c) => c.url.includes('/manage'))!;
    expect((edit.body as { standard_codes: string[] }).standard_codes).toEqual([]);
  });

  it('multi-day → pager switches days and saves both', async () => {
    const days = [day({ lesson_id: 'L1', day_index: 1, title: 'Day 1' }), day({ lesson_id: 'L2', day_index: 2, title: 'Day 2' })];
    render(<LessonReviewEditor days={days} chapterTitle="Unit" framework="TEKS" classId="c1" />);
    expect(screen.getByRole('button', { name: /day 2/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /make quiz/i }));
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/quizzes/generate')).length).toBe(2));
    expect(calls.filter((c) => c.url.includes('/manage')).length).toBe(2);
  });

  it('shows a "building" done state with library links after success — teacher is freed immediately', async () => {
    render(<LessonReviewEditor days={[day()]} chapterTitle={null} framework="TEKS" classId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: /make quiz/i }));
    await waitFor(() => expect(screen.getByRole('link', { name: /quiz library|open the quiz/i })).toBeInTheDocument());
    // The done state should indicate the quiz is being built (not that it's ready).
    expect(screen.getByText(/being built/i)).toBeInTheDocument();
  });

  it('multi-day done state shows "quizzes are being built"', async () => {
    const days = [day({ lesson_id: 'L1', day_index: 1, title: 'Day 1' }), day({ lesson_id: 'L2', day_index: 2, title: 'Day 2' })];
    render(<LessonReviewEditor days={days} chapterTitle="Unit" framework="TEKS" classId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: /make quiz/i }));
    await waitFor(() => expect(screen.getByRole('link', { name: /quiz library|open the quiz/i })).toBeInTheDocument());
    expect(screen.getByText(/quizzes are being built/i)).toBeInTheDocument();
  });
});
