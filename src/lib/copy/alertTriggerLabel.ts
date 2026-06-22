// Teacher-only alert labels + severity buckets. Banned-word-free (count-bearing OK; teacher surface).
// DRAFT → Barb (STRINGS-FOR-BARB.md §Alerts). Bucket copy reused from V1 (Barb 2026-05-13).
import { assertNoBannedWord } from '@/lib/copy/leakGuard';

export type AlertSourceKind = 'low_quiz' | 'low_assignment' | 'reteach_flag' | 'reteach_review' | 'strong_result';
export type AlertSeverity = 'urgent' | 'watch' | 'info';

const LABELS: Record<AlertSourceKind, string> = {
  low_quiz: 'A comprehension check came back low on the latest try',
  low_assignment: 'An assignment just came back with a low grade',
  reteach_flag: 'You flagged this student for another try',
  reteach_review: 'Another try is in — ready for your review',
  strong_result: 'A strong recent result — worth a high-five?',
};

export function alertTriggerLabel(kind: AlertSourceKind): string {
  const label = LABELS[kind];
  assertNoBannedWord(label, 'alertTriggerLabel');
  return label;
}

export const ALERT_BUCKETS: { severity: AlertSeverity; label: string; subline: string }[] = [
  { severity: 'urgent', label: 'Needs attention this week', subline: 'Worth a check-in within the next few days.' },
  { severity: 'watch', label: 'Check in', subline: 'Look at when you have a moment.' },
  { severity: 'info', label: 'Heads-up', subline: 'Good news — nothing to do.' },
];

export function severityTone(sev: AlertSeverity): 'risk' | 'warn' | 'brand' {
  return sev === 'urgent' ? 'risk' : sev === 'watch' ? 'warn' : 'brand';
}
