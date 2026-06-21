// src/app/(student)/student/assignments/[id]/__tests__/page.test.tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth/requireRole', () => ({ requireRole: vi.fn().mockResolvedValue({ userId: 's1' }) }));

// The detail page reads: admin.from('assignments').select(...).eq('id', id).maybeSingle()
const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));
vi.mock('../_components/SparkLaunchCard', () => ({
  SparkLaunchCard: ({ sparkStatus }: { sparkStatus: string }) => (
    <div data-testid="spark-card">{sparkStatus}</div>
  ),
}));

import StudentAssignmentDetail from '@/app/(student)/student/assignments/[id]/page';
const renderPage = async (p = { id: 'a1' }) =>
  render(await StudentAssignmentDetail({ params: Promise.resolve(p) }));

beforeEach(() => {
  maybeSingle.mockReset();
});

describe('StudentAssignmentDetail — Start CTA', () => {
  it('shows the existence-hiding EmptyState when not owned', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    await renderPage();
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it('shows a non-SPARK Start link to the player when spark_status is none', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'a1', student_id: 's1', content: { title: 'Essay', instructions: 'Write it.' }, spark_status: 'none' },
    });
    await renderPage();
    const link = screen.getByRole('link', { name: /start/i });
    expect(link).toHaveAttribute('href', '/student/assignments/a1/play');
    // a non-SPARK assignment must NOT render the Spark launch card
    expect(screen.queryByTestId('spark-card')).not.toBeInTheDocument();
  });

  it('renders SparkLaunchCard (and NO Start link) for a SPARK assignment', async () => {
    maybeSingle.mockResolvedValue({
      data: { id: 'a1', student_id: 's1', content: { title: 'Challenge' }, spark_status: 'created' },
    });
    await renderPage();
    expect(screen.getByTestId('spark-card')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /start/i })).not.toBeInTheDocument();
  });
});
