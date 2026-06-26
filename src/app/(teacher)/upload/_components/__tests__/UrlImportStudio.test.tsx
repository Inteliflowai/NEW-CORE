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

// ── Drive URL branch ──────────────────────────────────────────────────────────

describe('UrlImportStudio — Drive URL branch', () => {
  it('shows the "Google Drive file detected" callout when a Drive URL is typed', () => {
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), {
      target: { value: 'https://docs.google.com/document/d/FILEID/edit' },
    });
    expect(screen.getByText(/Google Drive file detected/i)).toBeInTheDocument();
  });

  it('hides the callout when the URL is cleared back to a non-Drive URL', () => {
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    const input = screen.getByLabelText(/link|url|web address/i);
    fireEvent.change(input, { target: { value: 'https://docs.google.com/document/d/FILEID/edit' } });
    expect(screen.getByText(/Google Drive file detected/i)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    expect(screen.queryByText(/Google Drive file detected/i)).toBeNull();
  });

  it('calls /import-drive (not /import-url) and sends file_id when a Drive URL is submitted', async () => {
    mockFetch({
      '/import-drive': () =>
        new Response(
          JSON.stringify({ lesson_id: 'LD1', parsed_content: { title: 'Drive Doc', key_concepts: [] } }),
          { status: 200 },
        ),
      '/quizzes/generate': () => new Response(JSON.stringify({ quiz_id: 'QD1' }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), {
      target: { value: 'https://docs.google.com/document/d/FILEID/edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());

    const driveCall = calls.find((c) => c.url.includes('/import-drive'));
    expect(driveCall).toBeDefined();
    expect((driveCall?.body as Record<string, unknown>)?.file_id).toBe('FILEID');
    expect((driveCall?.body as Record<string, unknown>)?.class_id).toBe('c1');
    expect(calls.some((c) => c.url.includes('/import-url'))).toBe(false);
  });

  it('falls back to /import-url when drive returns { connected: false }', async () => {
    mockFetch({
      '/import-drive': () =>
        new Response(JSON.stringify({ connected: false }), { status: 200 }),
      '/import-url': () =>
        new Response(
          JSON.stringify({ lesson_id: 'LFB1', parsed_content: { title: 'Fallback Doc', key_concepts: [] } }),
          { status: 200 },
        ),
      '/quizzes/generate': () => new Response(JSON.stringify({ quiz_id: 'QFB1' }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), {
      target: { value: 'https://docs.google.com/document/d/FILEID/edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes('/import-drive'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/import-url'))).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back to /import-url when drive returns drive_not_found (404)', async () => {
    mockFetch({
      '/import-drive': () =>
        new Response(JSON.stringify({ code: 'drive_not_found', error: 'File not found in Drive' }), { status: 404 }),
      '/import-url': () =>
        new Response(
          JSON.stringify({ lesson_id: 'LFB2', parsed_content: { title: 'Web Fallback', key_concepts: [] } }),
          { status: 200 },
        ),
      '/quizzes/generate': () => new Response(JSON.stringify({ quiz_id: 'QFB2' }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), {
      target: { value: 'https://docs.google.com/document/d/FILEID/edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes('/import-drive'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/import-url'))).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('non-Drive URL still calls /import-url and does NOT show the Drive callout (regression)', async () => {
    mockFetch({
      '/import-url': () =>
        new Response(
          JSON.stringify({ lesson_id: 'LU1', parsed_content: { title: 'Web Page', key_concepts: [] } }),
          { status: 200 },
        ),
      '/quizzes/generate': () => new Response(JSON.stringify({ quiz_id: 'QU1' }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), {
      target: { value: 'https://example.com/lesson' },
    });
    expect(screen.queryByText(/Google Drive/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());
    expect(calls[0].url).toContain('/import-url');
    expect(calls.some((c) => c.url.includes('/import-drive'))).toBe(false);
  });
});
