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
import { checkRateLimit, aiRateLimit } from '@/lib/rateLimit';

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

  // ── M3: Rate-limit the force/generate path ────────────────────────────────────
  // In a Server Component we cannot return a NextResponse 429, so we use
  // checkRateLimit → { success } and silently fall back to cache when over-limit.
  // A hammered ?force=1 becomes a cache-served request rather than unbounded AI calls.
  let forceRefresh = forceParam === '1';
  if (forceRefresh) {
    const { success } = await checkRateLimit(aiRateLimit, userId);
    if (!success) {
      forceRefresh = false; // rate-limited: serve from cache
    }
  }

  // ── Parallel data load ────────────────────────────────────────────────────────
  const [narrative, highFives, snapshotResult] = await Promise.all([
    // I6: use getParentNarrative (shared cache layer), never the engine directly
    getParentNarrative(admin, childId, { force: forceRefresh }),
    loadStudentHighFivesReadonly(admin, childId),
    // M4: Fetch most-recent 20 descending, then reverse to chronological ASC for
    // the chart. Raw avg_score values are normalized 0-1 below — never leave server.
    admin
      .from('student_model_snapshots')
      .select('avg_score, snapshot_date')
      .eq('student_id', childId)
      .order('snapshot_date', { ascending: false })
      .limit(20),
  ]);

  // ── Build digit-free growth data ──────────────────────────────────────────────
  // M4: reverse the DESC fetch back to chronological ASC order so the chart
  // draws oldest→newest left-to-right, matching the series used in getParentNarrative.
  const snapshots: SnapshotRow[] = (
    (snapshotResult.data ?? []) as SnapshotRow[]
  )
    .filter((s) => s.avg_score != null)
    .reverse();

  // M7: Normalize avg_score to relative 0–1 positions before passing to the client.
  // GrowthMotif and GradeTrendSparkline draw the same visual SHAPE from 0-1 values
  // as from raw scores. The raw numbers never leave the server — they are not
  // recoverable via devtools, source maps, or component props.
  const rawScores: number[] = snapshots.map((s) => s.avg_score as number);
  const minScore = rawScores.length > 0 ? Math.min(...rawScores) : 0;
  const maxScore = rawScores.length > 0 ? Math.max(...rawScores) : 0;
  const range = (maxScore - minScore) || 1; // guard divide-by-zero on flat series
  const normalizedScores: number[] = rawScores.map((s) => (s - minScore) / range);

  // Normalized 0–1 series for GrowthMotif bars (≥4 for non-cold-start).
  // Raw digits are normalized server-side and never reach the client.
  const growthHistory: number[] = normalizedScores;

  // C3: sparkline points with digit-free labels ('' → SeeMoreDetail converts to 'activity').
  // grade field carries the normalized 0–1 position, not the raw score.
  const sparklinePoints: DigitFreeSparklinePoint[] = snapshots.map((s, i) => ({
    date: s.snapshot_date,
    grade: normalizedScores[i], // normalized 0-1, raw score NOT included in client props
    label: '', // digit-free; SeeMoreDetail ensures the <title> fallback never fires
  }));

  // M6: Derive the trend direction word from the same series — unified cold-start
  // gate at n<4 (matches GrowthMotif COLD_START_THRESHOLD and computeDirection).
  const gradeTrendDirection = deriveDirection(normalizedScores);

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
 * M6: Returns null for cold-start (<4 points) to unify with GrowthMotif's threshold.
 */
function deriveDirection(
  scores: number[],
): 'climbing' | 'steady' | 'sliding' | null {
  const n = scores.length;
  if (n < 4) return null;

  const mid = Math.floor(n / 2);
  const earlier = scores.slice(0, mid);
  const recent = scores.slice(mid);
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const delta = mean(recent) - mean(earlier);

  // Use a proportional threshold on normalized [0,1] scores:
  // DIRECTION_DELTA_THRESHOLD of 3 on a 0-100 scale ≈ 0.03 on a 0-1 scale.
  if (delta > 0.03) return 'climbing';
  if (delta < -0.03) return 'sliding';
  return 'steady';
}
