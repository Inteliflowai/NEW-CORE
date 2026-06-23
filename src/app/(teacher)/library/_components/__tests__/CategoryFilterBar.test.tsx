// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CategoryFilterBar } from '../CategoryFilterBar';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function setup(overrides: Partial<React.ComponentProps<typeof CategoryFilterBar>> = {}) {
  const onSearch = vi.fn();
  const onSubject = vi.fn();
  const onGrade = vi.fn();
  const onBucket = vi.fn();
  const props = {
    classes: [{ id: 'c1', label: 'Bio' }],
    currentClassId: 'c1',
    classBasePath: '/library/lessons',
    search: '',
    onSearch,
    searchPlaceholder: 'Find a lesson',
    subjects: ['Math', 'Science'],
    subject: 'all',
    onSubject,
    grades: ['7', '8'],
    grade: 'all',
    onGrade,
    bucket: 'all' as const,
    onBucket,
    dateLabel: 'Added',
    ...overrides,
  };
  render(<CategoryFilterBar {...props} />);
  return { onSearch, onSubject, onGrade, onBucket };
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('CategoryFilterBar', () => {
  it('renders Subject + Grade dropdowns with an "All" option plus each value', () => {
    setup();
    expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Science' })).toBeInTheDocument();
    expect(screen.getByLabelText('Grade')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Grade 8' })).toBeInTheDocument();
  });

  it('fires onSubject / onGrade / onSearch / onBucket on change', () => {
    const { onSubject, onGrade, onSearch, onBucket } = setup();
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Science' } });
    expect(onSubject).toHaveBeenCalledWith('Science');
    fireEvent.change(screen.getByLabelText('Grade'), { target: { value: '8' } });
    expect(onGrade).toHaveBeenCalledWith('8');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'photo' } });
    expect(onSearch).toHaveBeenCalledWith('photo');
    fireEvent.change(screen.getByLabelText('Added'), { target: { value: 'week' } });
    expect(onBucket).toHaveBeenCalledWith('week');
  });

  it('honors the dateLabel prop (e.g. "When" for the Quiz Library)', () => {
    setup({ dateLabel: 'When' });
    expect(screen.getByLabelText('When')).toBeInTheDocument();
  });
});
