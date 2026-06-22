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

// I3 — four-audience leaks that would otherwise reach the student verbatim.
// All case-insensitive, word-boundary-anchored to avoid false positives ("basics", "bands").
export const FOUR_AUDIENCE_LEAKS: { pattern: RegExp; phrase: string; suggestion: string }[] = [
  // (a) spelled-out percent (the digit "%" is already caught by hasLeak).
  { pattern: /\bpercent\b/i, phrase: 'percent', suggestion: 'Keep it about the effort — no numbers or grades.' },
  // (b) band-enum / mastery vocabulary (teacher-only machinery, never shown to a student).
  { pattern: /\badvanced\b/i, phrase: 'a level word', suggestion: 'Describe the effort, not a level.' },
  { pattern: /\bgrade level\b/i, phrase: 'a level word', suggestion: 'Describe the effort, not a level.' },
  { pattern: /\bproficient\b/i, phrase: 'a level word', suggestion: 'Describe the effort, not a level.' },
  { pattern: /\breteach\b/i, phrase: 'a level word', suggestion: 'Describe the effort, not a level.' },
  { pattern: /\bmastery\b/i, phrase: 'a level word', suggestion: 'Describe the effort, not a level.' },
  { pattern: /\bband\b/i, phrase: 'a level word', suggestion: 'Describe the effort, not a level.' },
  { pattern: /\bbelow basic\b/i, phrase: 'a level word', suggestion: 'Describe the effort, not a level.' },
  { pattern: /\bbasic\b/i, phrase: 'a level word', suggestion: 'Describe the effort, not a level.' },
  { pattern: /\bremedial\b/i, phrase: 'a level word', suggestion: 'Describe the effort, not a level.' },
  // (c) peer-relative framing (growth is "you vs your own past", never peer-relative).
  { pattern: /\btop of the class\b/i, phrase: 'a comparison', suggestion: 'Compare them only to their own past, never to others.' },
  { pattern: /\bbest in\b/i, phrase: 'a comparison', suggestion: 'Compare them only to their own past, never to others.' },
  { pattern: /\bahead of\b/i, phrase: 'a comparison', suggestion: 'Compare them only to their own past, never to others.' },
  { pattern: /\bbeat\b/i, phrase: 'a comparison', suggestion: 'Compare them only to their own past, never to others.' },
  { pattern: /\bclassmates\b/i, phrase: 'a comparison', suggestion: 'Compare them only to their own past, never to others.' },
  { pattern: /\bthan half\b/i, phrase: 'a comparison', suggestion: 'Compare them only to their own past, never to others.' },
  { pattern: /\bmost of the class\b/i, phrase: 'a comparison', suggestion: 'Compare them only to their own past, never to others.' },
  { pattern: /\bthan (?:the )?(?:rest|others)\b/i, phrase: 'a comparison', suggestion: 'Compare them only to their own past, never to others.' },
  // (d) letter grades.
  { pattern: /\bgot an? [ABCDF]\b/, phrase: 'a letter grade', suggestion: 'Keep it about the effort — no grades.' },
  { pattern: /\bearned an? [ABCDF]\b/, phrase: 'a letter grade', suggestion: 'Keep it about the effort — no grades.' },
];

/** True if the note is only emoji / punctuation / whitespace — no actual words. */
function isEmojiOrPunctuationOnly(text: string): boolean {
  // Strip everything that is NOT a letter or digit; if nothing meaningful remains, it is empty praise.
  return /\S/.test(text) && !/[\p{L}\p{N}]/u.test(text);
}

export function validateHighFive(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const f of FORBIDDEN_PRAISE) if (f.pattern.test(text)) violations.push({ phrase: f.phrase, suggestion: f.suggestion });
  for (const f of FOUR_AUDIENCE_LEAKS) if (f.pattern.test(text)) violations.push({ phrase: f.phrase, suggestion: f.suggestion });
  if (isEmojiOrPunctuationOnly(text)) violations.push({ phrase: 'no real words', suggestion: 'Name the specific thing they did, in words.' });
  if (hasLeak(text)) violations.push({ phrase: 'a number or percent', suggestion: 'Keep it about the effort — no numbers or grades.' });
  if (hasBannedWord(text)) violations.push({ phrase: 'a data word', suggestion: 'Use plain, human language.' });
  return violations;
}
