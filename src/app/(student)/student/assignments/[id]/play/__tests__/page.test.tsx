// src/app/(student)/student/assignments/[id]/play/__tests__/page.test.tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/auth/requireRole', () => ({ requireRole: vi.fn().mockResolvedValue({ userId: 's1' }) }));
vi.mock('@/lib/supabase/server', () => ({ createAdminSupabaseClient: () => ({}) }));
// vi.hoisted so the mock factory below can reference `load` (vi.mock is hoisted above plain consts).
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/assignments/loadAssignmentForPlay', () => ({ loadAssignmentForPlay: load }));
vi.mock('../_components/AssignmentPlayer', () => ({ AssignmentPlayer: () => <div data-testid="player" /> }));

import AssignmentPlayPage from '@/app/(student)/student/assignments/[id]/play/page';
const renderPage = async (p = { id: 'a1' }) => render(await AssignmentPlayPage({ params: Promise.resolve(p) }));

describe('AssignmentPlayPage', () => {
  it('shows the existence-hiding EmptyState when not owned', async () => {
    load.mockResolvedValue({ ownershipOk: false });
    await renderPage();
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });
  it('renders the player when owned, non-spark, not locked', async () => {
    load.mockResolvedValue({ ownershipOk: true, sparkBlocked: false, gradedLocked: false, assignment: { id: 'a1', content: { tasks: [] } }, attempt: { id: 'att1', status: 'in_progress', responses: { tasks: {} }, attempt_no: 1 } });
    await renderPage();
    expect(screen.getByTestId('player')).toBeInTheDocument();
  });
  it('shows a graded/locked screen when gradedLocked', async () => {
    load.mockResolvedValue({ ownershipOk: true, sparkBlocked: false, gradedLocked: true, assignment: { id: 'a1', content: {} }, attempt: { id: 'att1', status: 'graded', responses: { tasks: {} }, attempt_no: 1 } });
    await renderPage();
    expect(screen.getByText(/already turned in|graded/i)).toBeInTheDocument();
  });
});
