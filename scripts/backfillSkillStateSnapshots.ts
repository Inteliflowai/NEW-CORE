// scripts/backfillSkillStateSnapshots.ts
// Demo/dev helper: write a few weeks of per-skill CL history so the Insights trend is visible
// before the weekly cron has accumulated real data. NOT used in production cron paths.
import type { SupabaseClient } from '@supabase/supabase-js';
import { isoWeekMonday } from '../src/lib/dates/isoWeekMonday';

export interface SkillStateHistoryRow {
  student_id: string;
  school_id: string | null;
  skill_id: string;
  snapshot_date: string;
  state: string;
  confidence: number;
}

// Older weeks skew to "needs more time"; later weeks skew to solid, so the class comprehension
// index climbs over time (honest synthetic demo data).
const EARLY = ['needs_more_time', 'needs_different_instruction', 'on_track'];
const LATE = ['on_track', 'ready_to_extend', 'needs_more_time'];

export function buildSkillStateHistoryRows(args: {
  studentIds: string[];
  skillIds: string[];
  weeks: number;
  refDate: Date;
  schoolId: string | null;
}): SkillStateHistoryRow[] {
  const { studentIds, skillIds, weeks, refDate, schoolId } = args;
  const rows: SkillStateHistoryRow[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(refDate.getTime() - w * 7 * 24 * 60 * 60 * 1000); // w weeks before ref
    const snapshot_date = isoWeekMonday(d);
    const pool = w >= Math.floor(weeks / 2) ? EARLY : LATE; // older half EARLY, newer half LATE
    studentIds.forEach((student_id, si) => {
      skillIds.forEach((skill_id, ki) => {
        const state = pool[(si + ki + w) % pool.length];
        rows.push({ student_id, school_id: schoolId, skill_id, snapshot_date, state, confidence: 70 });
      });
    });
  }
  return rows;
}

export async function backfillSkillStateSnapshots(
  admin: SupabaseClient,
  args: { studentIds: string[]; skillIds: string[]; weeks: number; refDate: Date; schoolId: string | null },
): Promise<void> {
  const rows = buildSkillStateHistoryRows(args);
  if (rows.length === 0) return;
  const { error } = await admin
    .from('skill_state_snapshots')
    .upsert(rows, { onConflict: 'student_id,skill_id,snapshot_date' });
  if (error) console.error('[backfillSkillStateSnapshots] upsert failed:', error);
}
