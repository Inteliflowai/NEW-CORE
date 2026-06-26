// src/lib/spark/groupChallenges.ts — pure grouping + labels for the teacher Spark Challenges screen.
// Teacher surface (scores/dates allowed). Count-bearing copy is DRAFT → Barb.
import type { ChallengeRow } from '@/lib/spark/loadChallenges';

export interface StudentChallengeGroup {
  studentId: string;
  studentName: string;
  summary: { scored: number; inProgress: number; notStarted: number };
  challenges: ChallengeRow[];
}

const STATE_ORDER: Record<ChallengeRow['status'], number> = { completed: 0, in_progress: 1, assigned: 2 };

/** Group flat challenge rows by student. Within a student: scored (completed) first by completedAt
 *  desc, then in-progress, then not-started. Students sorted by name (stable, scannable). */
export function groupChallengesByStudent(rows: ChallengeRow[]): StudentChallengeGroup[] {
  const byStudent = new Map<string, ChallengeRow[]>();
  for (const r of rows) {
    const arr = byStudent.get(r.studentId);
    if (arr) arr.push(r); else byStudent.set(r.studentId, [r]);
  }
  const groups: StudentChallengeGroup[] = [];
  for (const [studentId, list] of byStudent) {
    const challenges = [...list].sort((a, b) => {
      const s = STATE_ORDER[a.status] - STATE_ORDER[b.status];
      if (s !== 0) return s;
      return (b.completedAt ?? '').localeCompare(a.completedAt ?? ''); // most-recent first
    });
    groups.push({
      studentId,
      studentName: list[0].studentName,
      summary: {
        scored: list.filter((c) => c.status === 'completed').length,
        inProgress: list.filter((c) => c.status === 'in_progress').length,
        notStarted: list.filter((c) => c.status === 'assigned').length,
      },
      challenges,
    });
  }
  groups.sort((a, b) => a.studentName.localeCompare(b.studentName));
  return groups;
}

/** Quiet mixed-state summary, e.g. "2 scored · 1 in progress". Only non-zero states. DRAFT → Barb. */
export function studentSummaryLabel(summary: StudentChallengeGroup['summary']): string {
  const parts: string[] = [];
  if (summary.scored > 0) parts.push(`${summary.scored} scored`);
  if (summary.inProgress > 0) parts.push(`${summary.inProgress} in progress`);
  if (summary.notStarted > 0) parts.push(`${summary.notStarted} not started`);
  return parts.join(' · ') || 'No challenges yet';
}

/** Short date e.g. "Jun 22". Rendered client-side (post-interaction), so no SSR/CSR mismatch. */
export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Tooltip lines: challenge name (first, bold in the card) + submission date or current state.
 *  Mirrors the gradebook cellTooltipLines. DRAFT → Barb. */
export function challengeTooltipLines(row: ChallengeRow): string[] {
  const lines = [row.title];
  if (row.status === 'completed' && row.completedAt) lines.push(`Submitted ${shortDate(row.completedAt)}`);
  else if (row.status === 'in_progress') lines.push('In progress — not submitted yet');
  else lines.push('Not started yet');
  return lines;
}
