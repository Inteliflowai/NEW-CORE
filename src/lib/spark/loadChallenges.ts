// src/lib/spark/loadChallenges.ts — teacher Spark Challenges screen loader.
// Caller MUST run requireRole (layout) + guardClassAccess(classId) BEFORE calling (admin client
// bypasses RLS). Mirrors loadRosterSignals' contract.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChallengeRow {
  studentId: string;
  studentName: string;
  assignmentId: string;
  title: string;
  status: 'assigned' | 'in_progress' | 'completed';
  transferScore: number | null;
  contentQuality: 'engaged' | 'minimal' | 'non_engaged' | null;
  rubric: Record<string, number | null> | null;
  completedAt: string | null;
  effortLabel: string | null;
  revisionCount: number | null;
  teliHintCount: number | null;
}

export interface ChallengesData {
  classId: string;
  challenges: ChallengeRow[];
}

interface AssignmentRow {
  id: string;
  student_id: string;
  spark_status: string;
  content: { title?: string } | null;
  users: { full_name?: string } | null;
}
interface CompletionRow {
  assignment_id: string;
  transfer_score: number | null;
  content_quality: 'engaged' | 'minimal' | 'non_engaged' | null;
  rubric_dimensions: Record<string, number | null> | null;
  completed_at: string | null;
  effort_label: string | null;
  revision_count: number | null;
  teli_hint_count: number | null;
}

export async function loadChallenges(admin: SupabaseClient, classId: string): Promise<ChallengesData> {
  const { data: aData } = await admin
    .from('assignments')
    .select('id, student_id, spark_status, content, users:student_id(full_name)')
    .eq('class_id', classId)
    .neq('spark_status', 'none')
    .limit(500);
  const assignments = (aData ?? []) as unknown as AssignmentRow[];
  if (assignments.length === 0) return { classId, challenges: [] };

  const ids = assignments.map((a) => a.id);
  const { data: cData } = await admin
    .from('spark_completions')
    .select('assignment_id, transfer_score, content_quality, rubric_dimensions, completed_at, effort_label, revision_count, teli_hint_count')
    .in('assignment_id', ids);
  const byAssignment = new Map<string, CompletionRow>();
  for (const c of (cData ?? []) as unknown as CompletionRow[]) byAssignment.set(c.assignment_id, c);

  const challenges: ChallengeRow[] = assignments.map((a) => {
    const c = byAssignment.get(a.id);
    const scored = c != null && (c.transfer_score != null || c.content_quality != null);
    const status: ChallengeRow['status'] = c ? (scored ? 'completed' : 'in_progress') : 'assigned';
    return {
      studentId: a.student_id,
      studentName: a.users?.full_name ?? 'Student',
      assignmentId: a.id,
      title: a.content?.title ?? 'Spark Challenge',
      status,
      transferScore: c?.transfer_score ?? null,
      contentQuality: c?.content_quality ?? null,
      rubric: c?.rubric_dimensions ?? null,
      completedAt: c?.completed_at ?? null,
      effortLabel: c?.effort_label ?? null,
      revisionCount: c?.revision_count ?? null,
      teliHintCount: c?.teli_hint_count ?? null,
    };
  });
  return { classId, challenges };
}
