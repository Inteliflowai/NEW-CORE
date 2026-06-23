// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import { UploadStudio } from '../UploadStudio';
import type { UploadLessonLite } from '../UploadStudio';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

// Existing lessons-lite for the fuzzy duplicate check.
const EXISTING: UploadLessonLite[] = [
  { id: 'L1', title: 'Photosynthesis Basics', concept_tags: ['photosynthesis', 'chloroplast'], status: 'pending_review' },
];

/** Builds a typed test file (jsdom File). */
function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

/** Drives the hidden file input that the studio renders. */
function chooseFile(file: File) {
  const input = screen.getByTestId('upload-file-input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
function jsonResponse(status: number, body: unknown): FetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('UploadStudio', () => {
  it('happy path: upload → parse → quiz drives to a "quiz ready" done state with library links', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/teacher/lessons/upload')) {
        return jsonResponse(201, { lesson_id: 'NEW1', file_url: 'x', file_name: 'cells.pdf', file_type: 'application/pdf' });
      }
      if (u.includes('/api/teacher/lessons/parse')) {
        return jsonResponse(200, { lesson_id: 'NEW1', parsed_content: { title: 'Cellular Respiration', key_concepts: ['ATP', 'mitochondria'] } });
      }
      if (u.includes('/api/teacher/quizzes/generate')) {
        return jsonResponse(200, { quiz_id: 'Q1', questions: [] });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<UploadStudio classId="c1" existingLessons={EXISTING} />);
    chooseFile(makeFile('cells.pdf', 'application/pdf'));

    // The done state shows the success heading + links to both libraries (carrying ?class=).
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());
    const done = screen.getByTestId('upload-done');
    const quizLink = within(done).getByRole('link', { name: /quiz/i });
    expect(quizLink).toHaveAttribute('href', expect.stringContaining('class=c1'));
    const lessonLink = within(done).getByRole('link', { name: /lesson/i });
    expect(lessonLink).toHaveAttribute('href', expect.stringContaining('class=c1'));

    // All three routes were orchestrated in order.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/lessons/upload'))).toBe(true);
    expect(urls.some((u) => u.includes('/lessons/parse'))).toBe(true);
    expect(urls.some((u) => u.includes('/quizzes/generate'))).toBe(true);
  });

  it('exact dup: a 409 from /upload shows the "already uploaded" modal with Open / Upload anyway', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/teacher/lessons/upload')) {
        // The forced retry carries force=true in the multipart body → succeeds.
        const body = init?.body;
        const forced = body instanceof FormData && body.get('force') === 'true';
        if (forced) {
          return jsonResponse(201, { lesson_id: 'NEW1', file_url: 'x', file_name: 'dup.pdf', file_type: 'application/pdf' });
        }
        return jsonResponse(409, {
          duplicate: true,
          existing_lesson_id: 'L1',
          existing_title: 'Photosynthesis Basics',
          existing_created_at: '2026-06-20T00:00:00Z',
          message: 'You already uploaded this file.',
        });
      }
      if (u.includes('/api/teacher/lessons/parse')) {
        return jsonResponse(200, { lesson_id: 'NEW1', parsed_content: { title: 'Dup', key_concepts: [] } });
      }
      if (u.includes('/api/teacher/quizzes/generate')) {
        return jsonResponse(200, { quiz_id: 'Q1', questions: [] });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<UploadStudio classId="c1" existingLessons={EXISTING} />);
    chooseFile(makeFile('dup.pdf', 'application/pdf'));

    const dialog = await screen.findByTestId('exact-dup-modal');
    expect(within(dialog).getByText(/already uploaded/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /open it/i })).toBeInTheDocument();

    // "Upload anyway" re-posts with force=true and continues to the done state.
    fireEvent.click(within(dialog).getByRole('button', { name: /upload anyway/i }));
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());
  });

  it('fuzzy dup: after parse, a near-duplicate gates quiz-gen behind the 3-option modal', async () => {
    let generateCalled = false;
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/teacher/lessons/upload')) {
        return jsonResponse(201, { lesson_id: 'NEW1', file_url: 'x', file_name: 'photo.pdf', file_type: 'application/pdf' });
      }
      if (u.includes('/api/teacher/lessons/parse')) {
        // Parsed title/concepts collide with the existing "Photosynthesis Basics" lesson.
        return jsonResponse(200, { lesson_id: 'NEW1', parsed_content: { title: 'Photosynthesis Basics', key_concepts: ['photosynthesis', 'light reactions'] } });
      }
      if (u.includes('/api/teacher/quizzes/generate')) {
        generateCalled = true;
        return jsonResponse(200, { quiz_id: 'Q1', questions: [] });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<UploadStudio classId="c1" existingLessons={EXISTING} />);
    chooseFile(makeFile('photo.pdf', 'application/pdf'));

    const dialog = await screen.findByTestId('fuzzy-dup-modal');
    expect(within(dialog).getByText(/Photosynthesis Basics/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /use that one/i })).toBeInTheDocument();
    // Quiz-gen has NOT run yet — the modal gates it.
    expect(generateCalled).toBe(false);

    // "Create anyway" continues to quiz-gen + the done state.
    fireEvent.click(within(dialog).getByRole('button', { name: /create anyway/i }));
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());
    expect(generateCalled).toBe(true);
  });

  it('fuzzy dup: "Cancel" archives the just-created orphan lesson (best-effort) and stops', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/teacher/lessons/upload')) {
        return jsonResponse(201, { lesson_id: 'NEW1', file_url: 'x', file_name: 'photo.pdf', file_type: 'application/pdf' });
      }
      if (u.includes('/api/teacher/lessons/parse')) {
        return jsonResponse(200, { lesson_id: 'NEW1', parsed_content: { title: 'Photosynthesis Basics', key_concepts: ['photosynthesis', 'light reactions'] } });
      }
      if (u.includes('/api/teacher/lessons/manage')) {
        return jsonResponse(200, { ok: true, lesson_id: 'NEW1', status: 'archived' });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<UploadStudio classId="c1" existingLessons={EXISTING} />);
    chooseFile(makeFile('photo.pdf', 'application/pdf'));

    const dialog = await screen.findByTestId('fuzzy-dup-modal');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));

    // The orphan near-duplicate lesson is archived via the manage route.
    await waitFor(() => {
      const manageCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/teacher/lessons/manage'));
      expect(manageCall).toBeTruthy();
      const body = JSON.parse((manageCall![1] as RequestInit).body as string);
      expect(body).toMatchObject({ lesson_id: 'NEW1', action: 'archive' });
    });
    // Quiz-gen never ran.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/quizzes/generate'))).toBe(false);
  });

  it('fuzzy dup: "Use that one" archives the just-created orphan lesson (best-effort)', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/teacher/lessons/upload')) {
        return jsonResponse(201, { lesson_id: 'NEW1', file_url: 'x', file_name: 'photo.pdf', file_type: 'application/pdf' });
      }
      if (u.includes('/api/teacher/lessons/parse')) {
        return jsonResponse(200, { lesson_id: 'NEW1', parsed_content: { title: 'Photosynthesis Basics', key_concepts: ['photosynthesis', 'light reactions'] } });
      }
      if (u.includes('/api/teacher/lessons/manage')) {
        return jsonResponse(200, { ok: true, lesson_id: 'NEW1', status: 'archived' });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<UploadStudio classId="c1" existingLessons={EXISTING} />);
    chooseFile(makeFile('photo.pdf', 'application/pdf'));

    const dialog = await screen.findByTestId('fuzzy-dup-modal');
    fireEvent.click(within(dialog).getByRole('link', { name: /use that one/i }));

    await waitFor(() => {
      const manageCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/teacher/lessons/manage'));
      expect(manageCall).toBeTruthy();
      const body = JSON.parse((manageCall![1] as RequestInit).body as string);
      expect(body).toMatchObject({ lesson_id: 'NEW1', action: 'archive' });
    });
  });

  it('drag-drop re-entry: dropping a second file while a modal is open starts no second chain', async () => {
    let uploadCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/teacher/lessons/upload')) {
        uploadCalls += 1;
        return jsonResponse(201, { lesson_id: 'NEW1', file_url: 'x', file_name: 'photo.pdf', file_type: 'application/pdf' });
      }
      if (u.includes('/api/teacher/lessons/parse')) {
        return jsonResponse(200, { lesson_id: 'NEW1', parsed_content: { title: 'Photosynthesis Basics', key_concepts: ['photosynthesis', 'light reactions'] } });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<UploadStudio classId="c1" existingLessons={EXISTING} />);
    chooseFile(makeFile('photo.pdf', 'application/pdf'));

    // First chain ends at the fuzzy-dup modal.
    await screen.findByTestId('fuzzy-dup-modal');
    expect(uploadCalls).toBe(1);

    // Drop a second file onto the drop zone WHILE the modal is open — must be ignored.
    const dropZone = container.querySelector('[class*="border-dashed"]') as HTMLElement;
    const second = makeFile('second.pdf', 'application/pdf');
    fireEvent.drop(dropZone, { dataTransfer: { files: [second] } });

    // No second upload was kicked off.
    await waitFor(() => expect(uploadCalls).toBe(1));
    expect(uploadCalls).toBe(1);
  });

  it('a bad-type file shows an inline error and never calls the upload route', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);

    render(<UploadStudio classId="c1" existingLessons={EXISTING} />);
    chooseFile(makeFile('virus.exe', 'application/x-msdownload'));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries no banned coach-posture words in any rendered prose', () => {
    const { container } = render(<UploadStudio classId="c1" existingLessons={EXISTING} />);
    expect(hasBannedWord(container.textContent ?? '')).toBe(false);
  });
});
