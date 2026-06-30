// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: 'student-1' }),
}));

const { pagedFn } = vi.hoisted(() => ({ pagedFn: vi.fn() }));
vi.mock('@/lib/highfives/loadStudentNotesPaged', () => ({
  loadStudentNotesPaged: pagedFn,
}));
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({}),
}));

import StudentNotesPage from '@/app/(student)/student/notes/page';

describe('StudentNotesPage', () => {
  it('renders empty state when no notes', async () => {
    pagedFn.mockResolvedValue({ notes: [], totalCount: 0 });
    render(await StudentNotesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it('renders a note card for each note', async () => {
    pagedFn.mockResolvedValue({
      notes: [
        { id: 'h1', note_text: 'Great work today!', created_at: '2026-06-01T10:00:00Z' },
      ],
      totalCount: 1,
    });
    render(await StudentNotesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('Great work today!')).toBeInTheDocument();
  });

  it('renders pagination links when there are multiple pages', async () => {
    pagedFn.mockResolvedValue({
      notes: Array.from({ length: 20 }, (_, i) => ({
        id: `h${i}`,
        note_text: `Note ${i}`,
        created_at: '2026-06-01T10:00:00Z',
      })),
      totalCount: 35,
    });
    render(await StudentNotesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('link', { name: /next/i })).toBeInTheDocument();
  });
});
