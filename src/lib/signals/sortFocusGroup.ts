// src/lib/signals/sortFocusGroup.ts
// Pure sort function for FocusGroupItem arrays.
// Sorts by: severity (DESC) → action priority (ASC) → name (ASC).
// Returns a new sorted array; input is never mutated.

import type { FocusGroupItem } from '@/lib/signals/loadRosterSignals';

/**
 * Get the priority of a suggestedAction for sorting.
 * Lower number = higher priority (sorts earlier).
 */
function actionPriority(action: string): number {
  // reteach = 0 (highest priority)
  // verbal_check = 1
  // practice = 1
  // profile = 2
  // monitor = 2
  switch (action) {
    case 'reteach':
      return 0;
    case 'verbal_check':
    case 'practice':
      return 1;
    case 'profile':
    case 'monitor':
      return 2;
    default:
      return 3; // fallback for unknown actions
  }
}

/**
 * Sorts a FocusGroupItem array by severity (DESC), then action priority (ASC),
 * then student name (ASC). Pure — returns a new array, does not mutate input.
 */
export function sortFocusGroup(items: readonly FocusGroupItem[]): FocusGroupItem[] {
  return [...items].sort((a, b) => {
    // 1. Severity DESC (higher severity first)
    const sevDiff = b.diagnosis.severity - a.diagnosis.severity;
    if (sevDiff !== 0) return sevDiff;

    // 2. Action priority ASC (lower priority index = higher priority = earlier)
    const aPriority = actionPriority(a.diagnosis.suggestedAction);
    const bPriority = actionPriority(b.diagnosis.suggestedAction);
    const priDiff = aPriority - bPriority;
    if (priDiff !== 0) return priDiff;

    // 3. Name ASC (alphabetical)
    return a.full_name.localeCompare(b.full_name);
  });
}
