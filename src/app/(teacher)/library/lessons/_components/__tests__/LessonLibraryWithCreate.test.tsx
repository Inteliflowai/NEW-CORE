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
  LessonLibrary: ({ onCreate }: { onCreate?: () => void }) => (
    <div data-testid="lesson-library">
      lesson-library
      {/* Expose the cold-start CTA so tests can trigger it */}
      {onCreate && (
        <button type="button" onClick={onCreate} data-testid="cold-start-cta">
          Create a lesson
        </button>
      )}
    </div>
  ),
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
  it('defaults to browse view: LessonLibrary is visible and "＋ Create a lesson" button is present', () => {
    render(<LessonLibraryWithCreate {...baseProps} />);
    // The LessonLibrary mock must be rendered.
    expect(screen.getByTestId('lesson-library')).toBeInTheDocument();
    // ContentStudioTabs must NOT be rendered yet.
    expect(screen.queryByTestId('content-studio-tabs')).not.toBeInTheDocument();
    // The create button must be present (identified by the ＋ prefix).
    expect(screen.getByRole('button', { name: /＋ create a lesson/i })).toBeInTheDocument();
  });

  it('"＋ Create a lesson" button has no aria-pressed attribute', () => {
    render(<LessonLibraryWithCreate {...baseProps} />);
    const createBtn = screen.getByRole('button', { name: /＋ create a lesson/i });
    expect(createBtn).not.toHaveAttribute('aria-pressed');
  });

  it('clicking "＋ Create a lesson" switches to create view and shows ContentStudioTabs', () => {
    render(<LessonLibraryWithCreate {...baseProps} />);
    const createBtn = screen.getByRole('button', { name: /＋ create a lesson/i });
    fireEvent.click(createBtn);
    // ContentStudioTabs mock must now appear.
    expect(screen.getByTestId('content-studio-tabs')).toBeInTheDocument();
    // LessonLibrary mock must be gone.
    expect(screen.queryByTestId('lesson-library')).not.toBeInTheDocument();
    // "Back to library" affordance must appear.
    expect(screen.getByRole('button', { name: /back to library/i })).toBeInTheDocument();
  });

  it('"Back to library" button has no aria-pressed attribute', () => {
    render(<LessonLibraryWithCreate {...baseProps} />);
    // Navigate to create.
    fireEvent.click(screen.getByRole('button', { name: /＋ create a lesson/i }));
    const backBtn = screen.getByRole('button', { name: /back to library/i });
    expect(backBtn).not.toHaveAttribute('aria-pressed');
  });

  it('clicking "Back to library" returns to browse view', () => {
    render(<LessonLibraryWithCreate {...baseProps} />);
    // Navigate to create.
    fireEvent.click(screen.getByRole('button', { name: /＋ create a lesson/i }));
    expect(screen.getByTestId('content-studio-tabs')).toBeInTheDocument();
    // Navigate back.
    fireEvent.click(screen.getByRole('button', { name: /back to library/i }));
    expect(screen.getByTestId('lesson-library')).toBeInTheDocument();
    expect(screen.queryByTestId('content-studio-tabs')).not.toBeInTheDocument();
  });

  it('cold-start onCreate callback switches to create view', () => {
    render(<LessonLibraryWithCreate {...baseProps} />);
    // The mock exposes a cold-start CTA button (data-testid="cold-start-cta") when onCreate is passed.
    const coldStartBtn = screen.getByTestId('cold-start-cta');
    fireEvent.click(coldStartBtn);
    // ContentStudioTabs must appear.
    expect(screen.getByTestId('content-studio-tabs')).toBeInTheDocument();
    expect(screen.queryByTestId('lesson-library')).not.toBeInTheDocument();
  });
});
