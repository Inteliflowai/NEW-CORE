// src/app/(parent)/parent/dashboard/page.tsx
//
// Parent dashboard — the calm "Learning Summary" view.
//
// Auth chain:
//   requireRole(['parent'])          ← layout already guards, but we need userId
//   loadParentChildren                ← keys off users.parent_id (same column as guardStudentAccess)
//   guardStudentAccess(childId)       ← object-level IDOR guard
//   redirect('/parent/dashboard')     ← M3: on deny use redirect(), NOT return NextResponse
//
// Four-audience: zero numbers; components carry C1/C3 render-time leak filters.
// Fail-soft: dashboard renders even when the AI is down (getParentNarrative never throws).

import React from 'react';
import { redirect } from 'next/navigation';

import { requireRole } from '@/lib/auth/requireRole';
import { guardStudentAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadParentChildren } from '@/lib/parent/loadParentChildren';
import { loadStudentHighFivesReadonly } from '@/lib/parent/loadStudentHighFivesReadonly';
import { getParentNarrative } from '@/lib/parent/getParentNarrative';

import { ChildSelector } from './_components/ChildSelector';
import { NarrativeCard } from './_components/NarrativeCard';
import { ConversationStarter } from './_components/ConversationStarter';
import { SeeMoreDetail } from './_components/SeeMoreDetail';
import type { DigitFreeSparklinePoint } from './_components/SeeMoreDetail';

// ── Snapshot row shape (only parent-safe fields selected) ─────────────────────

interface SnapshotRow {
  avg_score: number | null;
  snapshot_date: string;
}

export default async function ParentDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; force?: string }>;
}): Promise<React.JSX.Element> {
  // ── Auth: requireRole returns userId we need for the children query ───────────
  const { userId } = await requireRole(['parent']);

  const admin = createAdminSupabaseClient();

  // ── Load children (keyed off users.parent_id) ─────────────────────────────────
  const children = await loadParentChildren(admin, userId);

  if (children.length === 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-xl bg-surface p-8 flex flex-col gap-3">
          <h1 className="font-display text-fg text-xl">Welcome</h1>
          <p className="text-fg-muted text-sm leading-relaxed">
            Your child's learning summary will appear here once they are connected to your account.
            Reach out to their school to get started.
          </p>
        </div>
      </div>
    );
  }

  // ── Resolve selected child ──────────────────────────────────────────────────
  const { child: childIdParam, force: forceParam } = await searchParams;

  // Validate the ?child= param is actually one of the parent's children (IDOR: list only)
  const selectedChild =
    childIdParam && children.some((c) => c.id === childIdParam)
      ? children.find((c) => c.id === childIdParam)!
      : children[0];

  const childId = selectedChild.id;

  // ── IDOR guard: guardStudentAccess returns NextResponse | null ────────────────
  // In a Server Component we MUST redirect(), never return the NextResponse (M3).
  const denied = await guardStudentAccess(childId);
  if (denied) redirect('/parent/dashboard');

  const forceRefresh = forceParam === '1';

  // ── Parallel data load ────────────────────────────────────────────────────────
  const [narrative, highFives, snapshotResult] = await Promise.all([
    // I6: use getParentNarrative (shared cache layer), never the engine directly
    getParentNarrative(admin, childId, { force: forceRefresh }),
    loadStudentHighFivesReadonly(admin, childId),
    // Growth data: avg_score series from student_model_snapshots (parent-safe; digits stay server-side)
    admin
      .from('student_model_snapshots')
      .select('avg_score, snapshot_date')
      .eq('student_id', childId)
      .order('snapshot_date', { ascending: true })
      .limit(20),
  ]);

  // ── Build digit-free growth data ──────────────────────────────────────────────
  const snapshots: SnapshotRow[] = (
    (snapshotResult.data ?? []) as SnapshotRow[]
  ).filter((s) => s.avg_score != null);

  // GrowthMotif bars — raw number values drive the visual; NEVER rendered as text
  const growthHistory: number[] = snapshots.map((s) => s.avg_score as number);

  // C3: sparkline points with digit-free labels ('' → SeeMoreDetail converts to 'activity')
  const sparklinePoints: DigitFreeSparklinePoint[] = snapshots.map((s) => ({
    date: s.snapshot_date,
    grade: s.avg_score as number,
    label: '', // digit-free; SeeMoreDetail ensures the <title> fallback never fires
  }));

  // Derive the trend direction word from the same series (matches loadParentNarrativeContext logic)
  const gradeTrendDirection = deriveDirection(growthHistory);

  // ── Refresh href ──────────────────────────────────────────────────────────────
  const refreshHref = `?child=${encodeURIComponent(childId)}&force=1`;

  return (
    <div className="p-5 max-w-2xl mx-auto flex flex-col gap-5">
      {/* Child selector (only when parent has >1 child) */}
      {children.length > 1 && (
        <ChildSelector children={children} selectedId={childId} />
      )}

      {/* Header */}
      <header className="flex items-center justify-between">
        <h1 className="font-display text-fg text-xl">
          {selectedChild.firstName}&apos;s Learning Summary
        </h1>
        <a
          href={refreshHref}
          className="text-xs text-fg-muted hover:text-brand transition-colors"
          aria-label="Refresh the learning summary"
        >
          Refresh
        </a>
      </header>

      {/* Centerpiece: AI narrative */}
      <NarrativeCard paragraphs={narrative.paragraphs} />

      {/* Conversation starter */}
      <ConversationStarter starters={narrative.conversation_starters} />

      {/* Collapsible: digit-free growth + high-fives */}
      <SeeMoreDetail
        highFives={highFives}
        growthHistory={growthHistory}
        sparklinePoints={sparklinePoints}
        gradeTrendDirection={gradeTrendDirection}
      />
    </div>
  );
}

// ── Internal helper ────────────────────────────────────────────────────────────

/**
 * Derive a direction word from a score series (mirrors loadParentNarrativeContext).
 * Returns null for cold-start (<3 points).
 */
function deriveDirection(
  scores: number[],
): 'climbing' | 'steady' | 'sliding' | null {
  const n = scores.length;
  if (n < 3) return null;

  const mid = Math.floor(n / 2);
  const earlier = scores.slice(0, mid);
  const recent = scores.slice(mid);
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const delta = mean(recent) - mean(earlier);

  if (delta > 3) return 'climbing';
  if (delta < -3) return 'sliding';
  return 'steady';
}
