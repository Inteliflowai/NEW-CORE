// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UrlImportStudio from '../UrlImportStudio';

const calls: Array<{ url: string; body: unknown }> = [];
function mockFetch(handlers: Record<string, () => Response>) {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body as string) : null });
    const key = Object.keys(handlers).find((k) => u.includes(k));
    return key ? handlers[key]() : new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => { calls.length = 0; });

describe('UrlImportStudio', () => {
  it('imports a URL with no dup → goes straight to a drafted quiz', async () => {
    mockFetch({
      '/import-url': () => new Response(JSON.stringify({ lesson_id: 'L1', parsed_content: { title: 'New Topic', key_concepts: ['x'] } }), { status: 200 }),
      '/quizzes/generate': () => new Response(JSON.stringify({ quiz_id: 'Q1' }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), { target: { value: 'https://docs.google.com/d/x/pub' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());
    expect(calls[0].url).toContain('/import-url');
    expect(calls.some((c) => c.url.includes('/quizzes/generate'))).toBe(true);
  });

  it('shows the url_fetch error message inline', async () => {
    mockFetch({ '/import-url': () => new Response(JSON.stringify({ error: "We couldn't open that link.", code: 'url_fetch' }), { status: 400 }) });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), { target: { value: 'https://bad' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t open/i));
  });

  it('shows the busy envelope (503) userMessage inline — never [object Object]', async () => {
    mockFetch({
      '/import-url': () => new Response(
        JSON.stringify({ error: { code: 'llm_exhausted', userMessage: 'The system is busy — please try again in a moment.', retryable: true } }),
        { status: 503 },
      ),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), { target: { value: 'https://x' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert).toHaveTextContent(/busy/i);
    expect(alert.textContent ?? '').not.toContain('[object Object]');
  });

  it('gates quiz-gen behind the fuzzy-dup modal when a near match exists', async () => {
    mockFetch({
      '/import-url': () => new Response(JSON.stringify({ lesson_id: 'L1', parsed_content: { title: 'Photosynthesis', key_concepts: ['light', 'chlorophyll'] } }), { status: 200 }),
      '/quizzes/generate': () => new Response(JSON.stringify({ quiz_id: 'Q1' }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[{ id: 'E1', title: 'Photosynthesis', concept_tags: ['light', 'chlorophyll'], status: 'draft' }]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), { target: { value: 'https://x' } });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByTestId('fuzzy-dup-modal')).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes('/quizzes/generate'))).toBe(false); // gated
  });
});
