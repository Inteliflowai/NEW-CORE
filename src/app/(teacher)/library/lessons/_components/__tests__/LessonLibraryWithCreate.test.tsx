// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LessonLibraryWithCreate } from '../LessonLibraryWithCreate';

// Mock heavy children to keep the toggle test focused.
vi.mock('../../../../upload/_components/ContentStudioTabs', () => ({
  ContentStudioTabs: () => <div data-testid="content-studio-tabs">create-studio</div>,
}));
vi.mock('../LessonLibrary', () => ({
  LessonLibrary: () => <div data-testid="lesson-library">lesson-library</div>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const baseProps = {
  data: { class_id: 'c1', lessons: [] } as Parameters<typeof LessonLibraryWithCreate>[0]['data'],
  classes: [],
  classId: 'c1',
  existingLessons: [],
  schoolState: null,
};

beforeEach(() => { vi.restoreAllMocks(); });

describe('LessonLibraryWithCreate', () => {
  it('defaults to browse view: LessonLibrary is visible and "＋ Create" button is present', () => {
    render(<LessonLibraryWithCreate {...baseProps} />);
    // The LessonLibrary mock must be rendered.
    expect(screen.getByTestId('lesson-library')).toBeInTheDocument();
    // ContentStudioTabs must NOT be rendered yet.
    expect(screen.queryByTestId('content-studio-tabs')).not.toBeInTheDocument();
    // The create button must be present.
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('clicking "＋ Create" switches to create view and shows ContentStudioTabs', () => {
    render(<LessonLibraryWithCreate {...baseProps} />);
    const createBtn = screen.getByRole('button', { name: /create/i });
    fireEvent.click(createBtn);
    // ContentStudioTabs mock must now appear.
    expect(screen.getByTestId('content-studio-tabs')).toBeInTheDocument();
    // LessonLibrary mock must be gone.
    expect(screen.queryByTestId('lesson-library')).not.toBeInTheDocument();
    // "Back to library" affordance must appear.
    expect(screen.getByRole('button', { name: /back to library/i })).toBeInTheDocument();
  });

  it('clicking "Back to library" returns to browse view', () => {
    render(<LessonLibraryWithCreate {...baseProps} />);
    // Navigate to create.
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(screen.getByTestId('content-studio-tabs')).toBeInTheDocument();
    // Navigate back.
    fireEvent.click(screen.getByRole('button', { name: /back to library/i }));
    expect(screen.getByTestId('lesson-library')).toBeInTheDocument();
    expect(screen.queryByTestId('content-studio-tabs')).not.toBeInTheDocument();
  });
});
