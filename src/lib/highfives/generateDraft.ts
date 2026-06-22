// AI first-draft for a teacher High-Five note. Generate → guardrail → retry once → deterministic fallback.
// Student-facing voice. NO digits/%/jargon/empty-praise. Mirrors Teli's generate-guarded shape.
import { claudeChat } from '@/lib/ai/claude';
import { CLAUDE_TUTOR_MODEL } from '@/lib/ai/models';
import { validateHighFive } from '@/lib/highfives/guardrail';

export interface DraftOpts { studentName: string; reasonHint?: string; contextHint?: string }

const SYSTEM = [
  'You write a SHORT note from a teacher to a student recognizing something specific they did.',
  'Rules: 1–2 sentences. Address the student by their first name. Name the SPECIFIC effort or thinking, not a trait.',
  'NEVER use empty praise ("great job", "amazing", "awesome", "excellent", "perfect", "you got this", "so smart").',
  'NEVER mention numbers, percentages, grades, scores, rankings, or any data/jargon words.',
  'Warm, plain, human. Output ONLY the note text — no quotes, no preamble.',
].join(' ');

const RETRY_SUFFIX = '\n\nThe previous attempt used empty praise or a number. Rewrite: name ONE concrete thing they did, plainly, no praise words, no numbers.';

export function fallbackDraft(studentName: string): string {
  return `${studentName}, your teacher noticed how you worked this week and wanted to name it.`;
}

export async function generateHighFiveDraft(opts: DraftOpts): Promise<{ draft_text: string; source: 'ai' | 'ai_retry' | 'fallback' }> {
  const user = [
    `Student first name: ${opts.studentName}`,
    opts.contextHint ? `What they did: ${opts.contextHint}` : '',
  ].filter(Boolean).join('\n');

  const first = await claudeChat(SYSTEM, user, { model: CLAUDE_TUTOR_MODEL });
  if (first && validateHighFive(first.trim()).length === 0) return { draft_text: first.trim(), source: 'ai' };

  const second = await claudeChat(SYSTEM + RETRY_SUFFIX, user, { model: CLAUDE_TUTOR_MODEL });
  if (second && validateHighFive(second.trim()).length === 0) return { draft_text: second.trim(), source: 'ai_retry' };

  return { draft_text: fallbackDraft(opts.studentName), source: 'fallback' };
}
