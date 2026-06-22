// Derived "worth recognizing today" suggestions. Pure. Context hints are STUDENT-FACING-safe (leak + banned-word free).
// DRAFT → Barb (STRINGS-FOR-BARB.md §High-Fives).
import { assertNoLeak, assertNoBannedWord } from '@/lib/copy/leakGuard';

export type HighFiveReason = 'persistence' | 'recovery' | 'effortful_success' | 'consistency_rising' | 'reteach_completed' | 'stretch';

export interface SuggestionInput {
  student_id: string; full_name: string;
  band: 'reteach' | 'grade_level' | 'advanced' | null;
  dominant_effort: string | null;
  trajectory: 'improving' | 'stable' | 'worsening' | null;
  had_recent_reteach_win: boolean;
  recent_high_five: boolean;
}
export interface HighFiveSuggestion { student_id: string; full_name: string; reason: HighFiveReason; context_hint: string }

const HINTS: Record<HighFiveReason, string> = {
  persistence: 'Kept at it through some tough work this week, even when it was a grind.',
  recovery: 'Bounced back after a rough patch — nice to see them climb again.',
  effortful_success: 'Worked hard and got there — earned that result.',
  consistency_rising: 'Steadier and steadier lately — the effort is showing.',
  reteach_completed: 'Came back for another try and pushed it further.',
  stretch: 'Ready for more — reaching past the standard and into deeper work.',
};
// Higher = surface first.
const PRIORITY: Record<HighFiveReason, number> = {
  persistence: 5, recovery: 4, reteach_completed: 4, effortful_success: 3, consistency_rising: 2, stretch: 1,
};

function reasonFor(i: SuggestionInput): HighFiveReason | null {
  if (i.dominant_effort === 'struggling_trying') return 'persistence';
  if (i.had_recent_reteach_win) return 'reteach_completed';
  if (i.trajectory === 'improving') return 'recovery';
  if (i.dominant_effort === 'effortful_success') return 'effortful_success';
  if (i.band === 'advanced') return 'stretch';
  return null;
}

export function buildHighFiveSuggestions(inputs: SuggestionInput[], limit = 5): HighFiveSuggestion[] {
  const out: HighFiveSuggestion[] = [];
  for (const i of inputs) {
    if (i.recent_high_five) continue;
    const reason = reasonFor(i);
    if (!reason) continue;
    const context_hint = HINTS[reason];
    assertNoLeak(context_hint, 'highFiveSuggestion'); assertNoBannedWord(context_hint, 'highFiveSuggestion');
    out.push({ student_id: i.student_id, full_name: i.full_name, reason, context_hint });
  }
  return out.sort((a, b) => PRIORITY[b.reason] - PRIORITY[a.reason] || a.full_name.localeCompare(b.full_name)).slice(0, limit);
}
