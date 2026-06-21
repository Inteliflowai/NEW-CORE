// src/lib/quiz/gradeTextToTier.ts
// Shared helper — parses a TEXT grade_level column value (migration 0001) into
// an age tier used for picking the correct score-message voice register.
//
// Mapping: K–5 → elementary, 6–8 → middle, 9–12 → high. Unparseable → middle.
// Used by: submit/route.ts and student-quiz/route.ts.
import type { Tier } from '@/lib/quiz/scoreMessage';

export function gradeTextToTier(gradeLevel: string | null | undefined): Tier {
  if (!gradeLevel) return 'middle';
  const n = parseInt(gradeLevel.replace(/[^0-9]/g, ''), 10);
  if (Number.isNaN(n)) return 'middle';
  if (n <= 5) return 'elementary';
  if (n <= 8) return 'middle';
  return 'high';
}
