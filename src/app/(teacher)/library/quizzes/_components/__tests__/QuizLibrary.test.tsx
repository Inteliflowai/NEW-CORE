// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import { QuizLibrary } from '../QuizLibrary';
import type { QuizLibrary as QuizLibraryData } from '@/lib/quizzes/loadQuizLibrary';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const FIXED_NOW = new Date('2026-06-23T12:00:00.000Z');

function data(): QuizLibraryData {
  return {
    class_id: 'c1',
    quizzes: [
      { id: 'q1', title: 'Photosynthesis — Check', lesson_title: 'Photosynthesis Basics', subject: 'Science', grade_level: '7', status: 'published', question_count: 5, published_at: '2026-06-22T00:00:00Z', created_at: '2026-06-20T00:00:00Z' },
      { id: 'q2', title: 'Cells — Check', lesson_title: 'Cell Structure', subject: 'Science', grade_level: '8', status: 'draft', question_count: 5, published_at: null, created_at: '2026-06-10T00:00:00Z' },
      { id: 'q3', title: 'Revolution — Check', lesson_title: null, subject: null, grade_level: null, status: 'draft', question_count: 5, published_at: null, created_at: '2026-05-15T00:00:00Z' },
    ],
  };
}

beforeEach(() => {
  refresh.mockReset();
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe('QuizLibrary', () => {
  it('renders one row per quiz with title, lesson, status pill, and question count — no banned words', () => {
    render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} />);
    expect(screen.getByText('Photosynthesis — Check')).toBeInTheDocument();
    expect(screen.getByText('Cells — Check')).toBeInTheDocument();
    expect(screen.getByText('Photosynthesis Basics')).toBeInTheDocument();
    // Status pills, not color alone ("Published" also appears in the date label → AllBy).
    expect(screen.getAllByText(/Published/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Draft/i).length).toBeGreaterThan(0);
    // No banned coach-posture words anywhere in the list prose.
    expect(hasBannedWord(document.body.textContent || '')).toBe(false);
  });

  it('the search box narrows the list by title/lesson', () => {
    render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} />);
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'cells' } });
    expect(screen.getByText('Cells — Check')).toBeInTheDocument();
    expect(screen.queryByText('Photosynthesis — Check')).toBeNull();
  });

  it('the date filter narrows by created date granularity', () => {
    render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} />);
    // "This week" should keep q1 (created Jun 20, within 7 days of Jun 23) and drop q3 (May 15).
    fireEvent.change(screen.getByLabelText(/when/i), { target: { value: 'week' } });
    expect(screen.getByText('Photosynthesis — Check')).toBeInTheDocument();
    expect(screen.queryByText('Revolution — Check')).toBeNull();
  });

  it('clicking a row opens the edit/detail dialog', () => {
    render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Cells — Check/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Publish posts action=publish to the manage route and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /Cells — Check/i }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: /^Publish/i }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/teacher/quizzes/manage');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ quiz_id: 'q2', action: 'publish' });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('a published quiz offers Unpublish (not Publish)', () => {
    render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /Photosynthesis — Check/i }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: /Unpublish/i })).toBeInTheDocument();
  });

  it('Save edit posts action=edit with the title + per-question fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} questions={{ q2: [{ id: 'qq1', position: 1, question_type: 'open', question_text: 'Why?', choices: null, rubric: 'Explain.' }] }} />);
    fireEvent.click(screen.getByRole('button', { name: /Cells — Check/i }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/title/i), { target: { value: 'Cells v2' } });
    fireEvent.click(dialog.getByRole('button', { name: /^Save/i }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const editCall = fetchMock.mock.calls.find((c) => JSON.parse((c[1] as RequestInit).body as string).action === 'edit');
    expect(editCall).toBeTruthy();
    const body = JSON.parse((editCall![1] as RequestInit).body as string);
    expect(body.quiz_id).toBe('q2');
    expect(body.title).toBe('Cells v2');
    expect(Array.isArray(body.questions)).toBe(true);
  });

  it('renders EmptyState when there are no quizzes', () => {
    render(<QuizLibrary data={{ class_id: 'c1', quizzes: [] }} classId="c1" now={FIXED_NOW} />);
    expect(screen.getByText(/No checks yet/i)).toBeInTheDocument();
  });

  it('groups rows under Subject · Grade headers and the Subject filter narrows the list', () => {
    render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} />);
    expect(screen.getByText('SCIENCE · GRADE 7')).toBeInTheDocument();
    expect(screen.getByText('SCIENCE · GRADE 8')).toBeInTheDocument();
    expect(screen.getByText('OTHER')).toBeInTheDocument();
    // Narrow to grade 8 → only the Cells check remains.
    fireEvent.change(screen.getByLabelText('Grade'), { target: { value: '8' } });
    expect(screen.getByText('Cells — Check')).toBeInTheDocument();
    expect(screen.queryByText('Photosynthesis — Check')).toBeNull();
  });

  it('Subject filter still matches a quiz whose inherited subject has surrounding whitespace', () => {
    const padded: QuizLibraryData = {
      class_id: 'c1',
      quizzes: [
        { id: 'qp', title: 'Padded — Check', lesson_title: 'L', subject: '  Science  ', grade_level: '7', status: 'draft', question_count: 3, published_at: null, created_at: '2026-06-20T00:00:00Z' },
      ],
    };
    render(<QuizLibrary data={padded} classId="c1" now={FIXED_NOW} />);
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Science' } });
    expect(screen.getByText('Padded — Check')).toBeInTheDocument();
  });

  it('shows a Class selector only when the teacher has more than one class', () => {
    const { rerender } = render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} classes={[{ id: 'c1', label: 'Bio' }]} />);
    expect(screen.queryByLabelText('Class')).toBeNull();
    rerender(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} classes={[{ id: 'c1', label: 'Bio' }, { id: 'c2', label: 'Chem' }]} />);
    expect(screen.getByLabelText('Class')).toBeInTheDocument();
  });

  // ── Building… affordance for 0-question quizzes ──────────────────────────────
  it('a quiz with 0 questions shows "Building…" pill and informational message instead of question count', () => {
    const building: QuizLibraryData = {
      class_id: 'c1',
      quizzes: [
        { id: 'qb', title: 'History — Check', lesson_title: 'WWI', subject: 'History', grade_level: '9', status: 'draft', question_count: 0, published_at: null, created_at: '2026-06-24T00:00:00Z' },
      ],
    };
    render(<QuizLibrary data={building} classId="c1" now={FIXED_NOW} />);
    expect(screen.getByText('Building…')).toBeInTheDocument();
    expect(screen.getByText(/Questions on their way/i)).toBeInTheDocument();
    // Should NOT show "0 questions"
    expect(screen.queryByText(/0 questions/i)).toBeNull();
    // No banned coach-posture words
    expect(hasBannedWord(document.body.textContent || '')).toBe(false);
  });

  it('a 0-question quiz row has aria-label "Building" (not the status word)', () => {
    const building: QuizLibraryData = {
      class_id: 'c1',
      quizzes: [
        { id: 'qb', title: 'History — Check', lesson_title: null, subject: null, grade_level: null, status: 'draft', question_count: 0, published_at: null, created_at: '2026-06-24T00:00:00Z' },
      ],
    };
    render(<QuizLibrary data={building} classId="c1" now={FIXED_NOW} />);
    const btn = screen.getByRole('button', { name: /History — Check/i });
    expect(btn.getAttribute('aria-label')).toMatch(/Building/);
  });

  it('Publish is disabled when the quiz has 0 questions (still building)', () => {
    const building: QuizLibraryData = {
      class_id: 'c1',
      quizzes: [
        { id: 'qb', title: 'History — Check', lesson_title: null, subject: null, grade_level: null, status: 'draft', question_count: 0, published_at: null, created_at: '2026-06-24T00:00:00Z' },
      ],
    };
    render(<QuizLibrary data={building} classId="c1" now={FIXED_NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /History — Check/i }));
    const dialog = within(screen.getByRole('dialog'));
    // "Questions are being built" notice is shown
    expect(dialog.getByText(/Questions are being built/i)).toBeInTheDocument();
    // Publish button is present but disabled
    const publishBtn = dialog.getByRole('button', { name: /Publish for students/i });
    expect(publishBtn).toBeDisabled();
  });

  it('Publish is enabled when the quiz has questions (non-zero count)', () => {
    render(<QuizLibrary data={data()} classId="c1" now={FIXED_NOW} />);
    fireEvent.click(screen.getByRole('button', { name: /Cells — Check/i }));
    const dialog = within(screen.getByRole('dialog'));
    const publishBtn = dialog.getByRole('button', { name: /Publish for students/i });
    expect(publishBtn).not.toBeDisabled();
  });

  // ── Google Classroom publish state ───────────────────────────────────────────
  it('a quiz in publishedQuizIds (with googleCourseId) shows "✓ In Google Classroom" — not a button', () => {
    render(
      <QuizLibrary
        data={data()}
        classId="c1"
        now={FIXED_NOW}
        googleCourseId="gc-course-1"
        publishedQuizIds={['q1']}
      />,
    );
    // The already-published row shows the indicator text.
    expect(screen.getByText('✓ In Google Classroom')).toBeInTheDocument();
    // The indicator is NOT a button.
    const indicator = screen.getByText('✓ In Google Classroom');
    expect(indicator.tagName.toLowerCase()).not.toBe('button');
    expect(indicator).not.toHaveAttribute('onclick');
  });

  it('a quiz NOT in publishedQuizIds (with googleCourseId) shows the "Publish to Classroom" button', () => {
    render(
      <QuizLibrary
        data={data()}
        classId="c1"
        now={FIXED_NOW}
        googleCourseId="gc-course-1"
        publishedQuizIds={['q1']}
      />,
    );
    // q2 and q3 are not published — they should each have the publish button.
    const publishBtns = screen.getAllByRole('button', { name: /Publish to Google Classroom/i });
    expect(publishBtns.length).toBeGreaterThanOrEqual(1);
    // "✓ In Google Classroom" appears exactly once (only for q1).
    expect(screen.getAllByText('✓ In Google Classroom')).toHaveLength(1);
  });

  it('after clicking Publish and the fetch resolves {ok:true} the row shows "✓ In Google Classroom"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QuizLibrary
        data={data()}
        classId="c1"
        now={FIXED_NOW}
        googleCourseId="gc-course-1"
        publishedQuizIds={[]}
      />,
    );
    // Click the "Publish to Classroom" button for q2 (Cells — Check row)
    const publishBtns = screen.getAllByRole('button', { name: /Publish to Google Classroom/i });
    fireEvent.click(publishBtns[0]);
    // After the fetch resolves, the row should show the indicator.
    await vi.waitFor(() => expect(screen.getByText('✓ In Google Classroom')).toBeInTheDocument());
    // "Publish to Classroom" for that row is gone (it is now the indicator).
    // There may be fewer publish buttons (or none if only one quiz had the button).
  });
});
