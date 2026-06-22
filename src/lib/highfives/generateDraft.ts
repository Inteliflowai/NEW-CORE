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

/**
 * One generation attempt. claudeChat THROWS LlmExhaustedError on retry-exhaustion (429/5xx/net)
 * and only returns null on 400/401/404/timeout — so a throw must be treated as null here or the
 * deterministic fallback is skipped and the draft route 500s. Mirrors Teli's tryGenerate
 * (src/lib/teli/generateHint.ts). Net: generateHighFiveDraft NEVER throws — always returns a draft.
 */
async function tryGenerate(system: string, user: string): Promise<string | null> {
  try {
    return await claudeChat(system, user, { model: CLAUDE_TUTOR_MODEL });
  } catch {
    return null; // LlmExhaustedError → flows to the existing retry/fallback path
  }
}

export async function generateHighFiveDraft(opts: DraftOpts): Promise<{ draft_text: string; source: 'ai' | 'ai_retry' | 'fallback' }> {
  const user = [
    `Student first name: ${opts.studentName}`,
    opts.contextHint ? `What they did: ${opts.contextHint}` : '',
  ].filter(Boolean).join('\n');

  const first = await tryGenerate(SYSTEM, user);
  if (first && validateHighFive(first.trim()).length === 0) return { draft_text: first.trim(), source: 'ai' };

  const second = await tryGenerate(SYSTEM + RETRY_SUFFIX, user);
  if (second && validateHighFive(second.trim()).length === 0) return { draft_text: second.trim(), source: 'ai_retry' };

  return { draft_text: fallbackDraft(opts.studentName), source: 'fallback' };
}
