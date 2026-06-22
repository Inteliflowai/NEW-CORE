// Empty-praise guardrail for teacher High-Five notes (student-facing). Fail-closed, deterministic.
// Mirrors the Teli sync-gate posture (src/lib/teli/revealCheck.ts). DRAFT phrases → Barb.
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';

export interface Violation { phrase: string; suggestion: string }

export const FORBIDDEN_PRAISE: { pattern: RegExp; phrase: string; suggestion: string }[] = [
  { pattern: /\bgreat job\b/i, phrase: 'great job', suggestion: 'Name the specific thing they did.' },
  { pattern: /\bgood job\b/i, phrase: 'good job', suggestion: 'Name the specific thing they did.' },
  { pattern: /\bamazing\b/i, phrase: 'amazing', suggestion: 'Describe what was actually impressive.' },
  { pattern: /\bawesome\b/i, phrase: 'awesome', suggestion: 'Describe what was actually impressive.' },
  { pattern: /\bexcellent\b/i, phrase: 'excellent', suggestion: 'Say what specifically was strong.' },
  { pattern: /\bperfect\b/i, phrase: 'perfect', suggestion: 'Point to the concrete thing they did well.' },
  { pattern: /\byou got this\b/i, phrase: 'you got this', suggestion: 'Name the effort you actually saw.' },
  { pattern: /\b(i'?m|i am) (so )?proud\b/i, phrase: "i'm proud", suggestion: 'Describe the work, not your reaction to it.' },
  { pattern: /\bso smart\b/i, phrase: 'so smart', suggestion: 'Praise the effort/strategy, not the trait.' },
];

export function validateHighFive(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const f of FORBIDDEN_PRAISE) if (f.pattern.test(text)) violations.push({ phrase: f.phrase, suggestion: f.suggestion });
  if (hasLeak(text)) violations.push({ phrase: 'a number or percent', suggestion: 'Keep it about the effort — no numbers or grades.' });
  if (hasBannedWord(text)) violations.push({ phrase: 'a data word', suggestion: 'Use plain, human language.' });
  return violations;
}
