// src/app/api/student/growth/route.ts
// GET /api/student/growth
//
// Student-facing growth view (Plan 3 Task 16 read API).
//
// Auth: auth.getUser() → student reads own snapshots only.
//
// CRITICAL: reads student_model_snapshots ONLY.
// NEVER reads skill_learning_state or misconception_observations —
// RLS + this route both enforce that constraint.
//
// Cold-start friendly: returns { cold_start: true, message } when no snapshots exist.
// Student voice register; never peer-relative.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { masteryDisplayLabel } from '@/lib/utils/masteryLabel';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();

  // ── Read student_model_snapshots ONLY for the caller's own student_id ───────
  // NOTE: we intentionally do NOT query skill_learning_state or
  //       misconception_observations — students cannot read those (RLS §0011).
  const { data: snapshots, error: snapErr } = await admin
    .from('student_model_snapshots')
    .select(
      'snapshot_date, avg_score, mastery_band, consistency_label, dominant_effort_pattern, strength_topics, struggle_topics, improvement_4w, snapshot_schema_version',
    )
    .eq('student_id', user.id)
    .order('snapshot_date', { ascending: false })
    .limit(12); // ~3 months of weekly snapshots

  if (snapErr) {
    console.error('[student/growth] snapshots fetch error:', snapErr);
    return NextResponse.json({ error: 'Failed to fetch growth data' }, { status: 500 });
  }

  // ── Cold-start: no snapshots yet ────────────────────────────────────────────
  if (!snapshots || snapshots.length === 0) {
    return NextResponse.json({
      cold_start: true,
      message: "Just getting started — check back after your first few quizzes to see your growth.",
      snapshots: [],
      next_action: null,
    });
  }

  // ── Return snapshot-framed growth view ─────────────────────────────────────
  // Shape is intentionally student-facing: no internal state names exposed.
  // FIX 2 (B2): mastery_band → soft 'mastery' label via masteryDisplayLabel (SCOPE §15).
  const formattedSnapshots = (snapshots as Array<{
    snapshot_date: string;
    avg_score: number | null;
    mastery_band: string | null;
    consistency_label: string | null;
    dominant_effort_pattern: string | null;
    strength_topics: string[] | null;
    struggle_topics: string[] | null;
    improvement_4w: number | null;
    snapshot_schema_version: string | null;
  }>).map((s) => ({
    snapshot_date: s.snapshot_date,
    avg_score: s.avg_score,
    // FIX 2: soft word, never raw enum (mastery_band never reaches student)
    mastery: masteryDisplayLabel(s.mastery_band),
    consistency_label: s.consistency_label,
    dominant_effort_pattern: s.dominant_effort_pattern,
    strength_topics: s.strength_topics ?? [],
    struggle_topics: s.struggle_topics ?? [],
    improvement_4w: s.improvement_4w,
  }));

  // ── FIX 3 (B1): derive a positive, non-diagnostic next_action ───────────────
  // DO NOT use diagnose() — that emits teacher-facing diagnostic actions (B6/A2).
  // Derive from what the student can already see: struggle_topics on latest snapshot.
  const latestSnap = snapshots[0] as {
    struggle_topics: string[] | null;
  };
  const struggleTopics = latestSnap.struggle_topics ?? [];
  let next_action: string | null;
  if (struggleTopics.length > 0) {
    // Encouraging, concrete prompt naming the first struggle topic
    next_action = `Keep practicing: ${struggleTopics[0]}`;
  } else {
    next_action = "You're on track — keep going.";
  }

  return NextResponse.json({
    cold_start: false,
    snapshots: formattedSnapshots,
    next_action,
  });
}
