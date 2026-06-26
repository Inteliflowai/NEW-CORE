// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/chapters',
}));

import { ChapterList } from '../ChapterList';
import type { ChapterRow, LessonRow } from '../ChapterList';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const chapters: ChapterRow[] = [
  {
    id: 'ch1',
    class_id: 'cl1',
    title: 'Chapter 1: The Basics',
    description: null,
    sequence: 1,
    created_at: '2026-01-01T00:00:00Z',
    archived_at: null,
    lesson_count: 2,
  },
  {
    id: 'ch2',
    class_id: 'cl1',
    title: 'Chapter 2: Advanced Topics',
    description: null,
    sequence: 2,
    created_at: '2026-01-02T00:00:00Z',
    archived_at: null,
    lesson_count: 1,
  },
];

const lessons: LessonRow[] = [
  { id: 'l1', title: 'Introduction', chapter_id: 'ch1' },
  { id: 'l2', title: 'Core Concepts', chapter_id: 'ch1' },
  { id: 'l3', title: 'Deep Dive', chapter_id: 'ch2' },
  { id: 'l4', title: 'Free Lesson', chapter_id: null },
];

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ chapter_id: 'ch-new', ok: true }),
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('ChapterList', () => {
  it('renders chapter titles', () => {
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);
    expect(screen.getByText('Chapter 1: The Basics')).toBeInTheDocument();
    expect(screen.getByText('Chapter 2: Advanced Topics')).toBeInTheDocument();
  });

  it('shows lesson count per chapter', () => {
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);
    // lesson counts appear next to the chapter headers
    expect(screen.getByText(/2 lesson/)).toBeInTheDocument();
    expect(screen.getByText(/1 lesson/)).toBeInTheDocument();
  });

  it('chapters are collapsed by default — assigned lessons not visible', () => {
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);
    expect(screen.queryByText('Introduction')).not.toBeInTheDocument();
    expect(screen.queryByText('Core Concepts')).not.toBeInTheDocument();
  });

  it('clicking a chapter expands it and shows its assigned lessons', () => {
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);
    const ch1Btn = screen.getByRole('button', { name: /expand chapter 1: the basics/i });
    fireEvent.click(ch1Btn);
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Core Concepts')).toBeInTheDocument();
    // Chapter 2's lesson not shown
    expect(screen.queryByText('Deep Dive')).not.toBeInTheDocument();
  });

  it('expanded chapter also shows unassigned lessons for adding', () => {
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);
    fireEvent.click(screen.getByRole('button', { name: /expand chapter 1: the basics/i }));
    // Free Lesson has no chapter_id → should appear in "Add lessons" section
    expect(screen.getByText('Free Lesson')).toBeInTheDocument();
  });

  it('shows empty state message when no chapters', () => {
    render(<ChapterList classId="cl1" chapters={[]} lessons={[]} />);
    expect(screen.getByText(/no chapters yet/i)).toBeInTheDocument();
  });

  it('clicking "＋ Add chapter" shows the add form', () => {
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);
    expect(screen.queryByLabelText(/chapter title/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add chapter/i }));
    expect(screen.getByLabelText(/chapter title/i)).toBeInTheDocument();
  });

  it('add form submits POST to /api/teacher/chapters with the typed title', async () => {
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);
    fireEvent.click(screen.getByRole('button', { name: /add chapter/i }));

    const titleInput = screen.getByLabelText(/chapter title/i);
    fireEvent.change(titleInput, { target: { value: 'Chapter 3: Extra' } });

    // The submit button text is "Add chapter" (same as opener — but it's a submit type)
    const submitBtn = screen.getByRole('button', { name: /^add chapter$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/teacher/chapters',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Chapter 3: Extra'),
        }),
      );
    });
  });

  it('add form includes classId in the POST body', async () => {
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);
    fireEvent.click(screen.getByRole('button', { name: /add chapter/i }));
    fireEvent.change(screen.getByLabelText(/chapter title/i), { target: { value: 'New Chapter' } });
    fireEvent.click(screen.getByRole('button', { name: /^add chapter$/i }));

    await waitFor(() => {
      const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
      expect(body.classId).toBe('cl1');
      expect(body.title).toBe('New Chapter');
    });
  });

  it('"Archive" button with confirm → calls DELETE /api/teacher/chapters/[id]', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);

    const archiveBtn = screen.getByRole('button', { name: /archive chapter 1: the basics/i });
    fireEvent.click(archiveBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/teacher/chapters/ch1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    confirmSpy.mockRestore();
  });

  it('"Archive" button does NOT call DELETE when user cancels confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);

    fireEvent.click(screen.getByRole('button', { name: /archive chapter 1: the basics/i }));

    // fetch should NOT have been called
    expect(global.fetch).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('each chapter shows up/down reorder buttons', () => {
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);
    expect(screen.getByRole('button', { name: /move chapter 1.*up/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move chapter 2.*down/i })).toBeInTheDocument();
  });

  it('first chapter "move up" button is disabled; last chapter "move down" is disabled', () => {
    render(<ChapterList classId="cl1" chapters={chapters} lessons={lessons} />);
    expect(screen.getByRole('button', { name: /move chapter 1.*up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /move chapter 2.*down/i })).toBeDisabled();
  });
});
