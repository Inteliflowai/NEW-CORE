// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { hasBannedWord } from '@/lib/copy/leakGuard';
import { LessonLibrary } from '../LessonLibrary';
import type { LessonLibrary as LessonLibraryData } from '@/lib/lessons/loadLessonLibrary';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

// Fixed clock so date-bucketing ("This month" / "This week" / "Today") is deterministic.
const NOW = new Date('2026-06-23T12:00:00Z');

const data: LessonLibraryData = {
  class_id: 'c1',
  lessons: [
    { id: 'L1', title: 'Photosynthesis', subject: 'Science', grade_level: '7', status: 'pending_review', quiz_count: 1, created_at: '2026-06-23T08:00:00Z', standard_codes: [], standard_framework: null, chapter_title: null, day_index: null, parsed_content: { objectives: ['Explain photosynthesis'], key_concepts: ['chlorophyll'], vocabulary: [], misconception_risks: [] } }, // today
    { id: 'L2', title: 'Fractions', subject: 'Math', grade_level: '6', status: 'draft', quiz_count: 0, created_at: '2026-06-21T08:00:00Z', standard_codes: [], standard_framework: null, chapter_title: null, day_index: null, parsed_content: null }, // this week
    { id: 'L3', title: 'The Revolution', subject: 'History', grade_level: '8', status: 'pending_review', quiz_count: 2, created_at: '2026-05-02T08:00:00Z', standard_codes: [], standard_framework: null, chapter_title: null, day_index: null, parsed_content: null }, // older month
  ],
};

beforeEach(() => { vi.restoreAllMocks(); });

describe('LessonLibrary', () => {
  it('renders a row per lesson with title and a status pill', () => {
    render(<LessonLibrary data={data} now={NOW} />);
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    expect(screen.getByText('Fractions')).toBeInTheDocument();
    expect(screen.getByText('The Revolution')).toBeInTheDocument();
    // A draft lesson surfaces a Draft status pill (label only — no enum machinery).
    expect(screen.getByText(/draft/i)).toBeInTheDocument();
  });

  it('the search box narrows the list by title', () => {
    render(<LessonLibrary data={data} now={NOW} />);
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'fraction' } });
    expect(screen.getByText('Fractions')).toBeInTheDocument();
    expect(screen.queryByText('Photosynthesis')).not.toBeInTheDocument();
    expect(screen.queryByText('The Revolution')).not.toBeInTheDocument();
  });

  it('the date filter narrows by created date bucket', () => {
    render(<LessonLibrary data={data} now={NOW} />);
    const select = screen.getByLabelText(/added/i);
    // "Today" → only the lesson created on 2026-06-23.
    fireEvent.change(select, { target: { value: 'today' } });
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    expect(screen.queryByText('Fractions')).not.toBeInTheDocument();
    expect(screen.queryByText('The Revolution')).not.toBeInTheDocument();
    // "This week" → today + this-week lessons, but not last month's.
    fireEvent.change(select, { target: { value: 'week' } });
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    expect(screen.getByText('Fractions')).toBeInTheDocument();
    expect(screen.queryByText('The Revolution')).not.toBeInTheDocument();
  });

  it('shows an empty state when no lessons match (and on cold start)', () => {
    render(<LessonLibrary data={data} now={NOW} />);
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'no-such-lesson-xyz' } });
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();

    const { container } = render(<LessonLibrary data={{ class_id: 'c1', lessons: [] }} now={NOW} />);
    // Cold-start EmptyState (no onCreate) + a fallback "Upload a lesson" link carrying ?class=.
    const upload = within(container).getByRole('link', { name: /upload a lesson/i });
    expect(upload).toHaveAttribute('href', expect.stringContaining('class=c1'));
  });

  it('cold-start with onCreate prop: renders a "Create a lesson" button instead of the upload link', () => {
    const onCreate = vi.fn();
    render(<LessonLibrary data={{ class_id: 'c1', lessons: [] }} now={NOW} onCreate={onCreate} />);
    // Should have a button, not a link
    const createBtn = screen.getByRole('button', { name: /create a lesson/i });
    expect(createBtn).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /upload a lesson/i })).not.toBeInTheDocument();
    // Clicking the button fires the callback
    fireEvent.click(createBtn);
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('groups rows under Subject · Grade section headers', () => {
    render(<LessonLibrary data={data} now={NOW} />);
    expect(screen.getByText('SCIENCE · GRADE 7')).toBeInTheDocument();
    expect(screen.getByText('MATH · GRADE 6')).toBeInTheDocument();
    expect(screen.getByText('HISTORY · GRADE 8')).toBeInTheDocument();
  });

  it('the Subject filter narrows the list', () => {
    render(<LessonLibrary data={data} now={NOW} />);
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Science' } });
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    expect(screen.queryByText('Fractions')).not.toBeInTheDocument();
    expect(screen.queryByText('The Revolution')).not.toBeInTheDocument();
  });

  it('the Grade filter narrows the list', () => {
    render(<LessonLibrary data={data} now={NOW} />);
    fireEvent.change(screen.getByLabelText('Grade'), { target: { value: '8' } });
    expect(screen.getByText('The Revolution')).toBeInTheDocument();
    expect(screen.queryByText('Photosynthesis')).not.toBeInTheDocument();
  });

  it('a "View lesson" button opens the lesson-plan dialog', () => {
    render(<LessonLibrary data={data} now={NOW} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const viewButtons = screen.getAllByRole('button', { name: /view lesson/i });
    fireEvent.click(viewButtons[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Subject filter still matches a row whose stored subject has surrounding whitespace', () => {
    const padded: LessonLibraryData = {
      class_id: 'c1',
      lessons: [
        { id: 'P1', title: 'Padded Science', subject: '  Science  ', grade_level: '7', status: 'draft', quiz_count: 0, created_at: '2026-06-23T08:00:00Z', standard_codes: [], standard_framework: null, chapter_title: null, day_index: null, parsed_content: null },
      ],
    };
    render(<LessonLibrary data={padded} now={NOW} />);
    // The dropdown option is the trimmed "Science"; selecting it must not filter the padded row out.
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Science' } });
    expect(screen.getByText('Padded Science')).toBeInTheDocument();
    expect(screen.queryByText(/nothing matches/i)).not.toBeInTheDocument();
  });

  it('shows a Class selector only when the teacher has more than one class', () => {
    const { rerender } = render(<LessonLibrary data={data} now={NOW} classes={[{ id: 'c1', label: 'Bio' }]} />);
    expect(screen.queryByLabelText('Class')).toBeNull();
    rerender(<LessonLibrary data={data} now={NOW} classes={[{ id: 'c1', label: 'Bio' }, { id: 'c2', label: 'Chem' }]} />);
    expect(screen.getByLabelText('Class')).toBeInTheDocument();
  });

  it('surfaces the unit/day meta and orders same-unit lessons by day within a group', () => {
    const unitData: LessonLibraryData = {
      class_id: 'c1',
      lessons: [
        // Same Subject·Grade group, same unit, supplied out of day order (Day 2 before Day 1).
        { id: 'U2', title: 'Unit Day Two', subject: 'Math', grade_level: '4', status: 'draft', quiz_count: 0, created_at: '2026-06-23T09:00:00Z', standard_codes: [], standard_framework: null, chapter_title: 'Fractions Unit', day_index: 2, parsed_content: null },
        { id: 'U1', title: 'Unit Day One', subject: 'Math', grade_level: '4', status: 'draft', quiz_count: 0, created_at: '2026-06-23T08:00:00Z', standard_codes: [], standard_framework: null, chapter_title: 'Fractions Unit', day_index: 1, parsed_content: null },
      ],
    };
    render(<LessonLibrary data={unitData} now={NOW} />);
    // Unit/day meta is surfaced on the row.
    expect(screen.getByText('Unit: Fractions Unit · Day 1')).toBeInTheDocument();
    expect(screen.getByText('Unit: Fractions Unit · Day 2')).toBeInTheDocument();
    // Within the group, Day 1 renders before Day 2 despite the reverse input order.
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf('Unit Day One')).toBeLessThan(headings.indexOf('Unit Day Two'));
  });

  it('carries no banned coach-posture words in any rendered prose', () => {
    const { container } = render(<LessonLibrary data={data} now={NOW} />);
    expect(hasBannedWord(container.textContent ?? '')).toBe(false);
  });
});
