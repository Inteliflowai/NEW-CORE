import type { SupabaseClient } from '@supabase/supabase-js';
import { hasParentLeak } from '@/lib/copy/parentGuard';

export interface ParentHighFive {
  id: string;
  /** Renamed from `note_text` — this is the parent-safe field; note_text stays on the teacher surface. */
  note: string;
  created_at: string;
}

/**
 * Read-only variant of `loadStudentHighFives` for the parent surface.
 *
 * Differences from the original loader:
 *  1. NO `viewed_by_student_at` write/stamp (read-only).
 *  2. C1 FILTER: any note whose `note_text` triggers `hasParentLeak` is DROPPED
 *     (high-five authors validate against the teacher guardrail at creation time,
 *     but that does NOT cover parent-forbidden terms like "on track", "behind",
 *     "reinforce", "peers", "class average", etc.).
 *
 * Returns `{ id, note, created_at }[]` — `note` (not `note_text`) signals
 * this is the parent-safe, already-filtered shape.
 */
export async function loadStudentHighFivesReadonly(
  admin: SupabaseClient,
  studentId: string,
  limit = 5,
): Promise<ParentHighFive[]> {
  const { data } = await admin
    .from('high_fives')
    .select('id, note_text, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as { id: string; note_text: string; created_at: string }[];

  return rows
    .filter((r) => !hasParentLeak(r.note_text))
    .map((r) => ({ id: r.id, note: r.note_text, created_at: r.created_at }));
}
