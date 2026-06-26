// src/lib/copy/parentGuard.ts
// The PARENT four-audience validator. A parent NEVER sees: numbers/grades, the mastery-band enum,
// risk, CL verbs, divergence, misconceptions, or peer comparisons. Reuses the generic numeric/word
// guards + the High-Five FOUR_AUDIENCE_LEAKS, adds the parent-specific gaps, and pre-normalizes
// separators so hyphenated variants ("grade-level", "on-track") can't bypass the wall. Pure, import-safe.
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';
import { FOUR_AUDIENCE_LEAKS } from '@/lib/highfives/guardrail';

export const PARENT_FORBIDDEN: { pattern: RegExp; phrase: string }[] = [
  { pattern: /\brisks?\b/i, phrase: 'risk' },
  { pattern: /\breinforc(?:e|es|ed|ing|ement)\b/i, phrase: 'reinforce' },
  { pattern: /\bon track\b/i, phrase: 'on track' },
  { pattern: /\bcomprehension levels?\b/i, phrase: 'comprehension level' },
  { pattern: /\bapproaching (?:grade|standard|proficiency|the next level)\b/i, phrase: 'approaching (band)' },
  // enrich/enriches/enriched/enriching/enrichment — all banned (covers the former separate 'enrichment' entry)
  { pattern: /\benrich(?:es|ed|ing|ment)?\b/i, phrase: 'enrichment' },
  { pattern: /\bpartial mastery\b/i, phrase: 'partial mastery' },
  { pattern: /\bmisconceptions?\b/i, phrase: 'misconception' },
  { pattern: /\berror types?\b/i, phrase: 'error type' },
  { pattern: /\bcompared to\b/i, phrase: 'compared to' },
  { pattern: /\bcompared with\b/i, phrase: 'compared with' },
  { pattern: /\b(?:versus|vs\.?)\b/i, phrase: 'versus' },
  { pattern: /\bfalling behind\b/i, phrase: 'falling behind' },
  { pattern: /\bbehind (?:the class|grade|schedule|the rest)\b/i, phrase: 'behind (comparison)' },
  { pattern: /\bclass average\b/i, phrase: 'class average' },
  { pattern: /\bpeers?\b/i, phrase: 'peers' },
  { pattern: /\bother students\b/i, phrase: 'other students' },
  { pattern: /\bthan average\b/i, phrase: 'than average' },
  { pattern: /\brest of the class\b/i, phrase: 'rest of the class' },
  { pattern: /\b[ABCDF][+\-]?\s+(?:level|grade|range|student|work|effort)\b/, phrase: 'a letter grade' },
  { pattern: /\bstraight\s+a'?s\b/i, phrase: 'straight As' },
  { pattern: /\b(?:a|an)\s+(?:solid|strong)\s+[ABCDF][+\-]?\b/, phrase: 'a letter grade' },
];

/** Violated phrases in `text` (empty = parent-safe). Separators (- – _) are normalized to spaces
 *  first so hyphenated variants can't bypass; "role model"/"model student" are exempted from the
 *  inherited 'model' banned-word (they're warm, not the ML sense). */
export function parentLeaks(text: string): string[] {
  const norm = text.replace(/[-–_]/g, ' ');
  const forBanned = norm.replace(/\brole model\b/gi, 'rolemodel').replace(/\bmodel student\b/gi, 'modelstudent');
  const out: string[] = [];
  if (hasLeak(norm)) out.push('a number or percent');
  if (hasBannedWord(forBanned)) out.push('a data word');
  for (const f of FOUR_AUDIENCE_LEAKS) if (f.pattern.test(norm)) out.push(f.phrase);
  for (const f of PARENT_FORBIDDEN) if (f.pattern.test(norm)) out.push(f.phrase);
  return out;
}

export function hasParentLeak(text: string): boolean {
  return parentLeaks(text).length > 0;
}
