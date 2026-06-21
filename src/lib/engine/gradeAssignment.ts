// src/lib/engine/gradeAssignment.ts
// Dedicated multi-task assignment grader — CONTINUOUS 0–100 (unlike the quiz OEQ grader
// which is locked to {0,0.5,1.0}). Assignments are GRADED coursework that counts toward
// the class final grade, so the student sees a real percentage. Claude primary (temp 0.3,
// 800 tok) → GPT fallback. Throws LlmExhaustedError on exhaustion — NEVER fabricates.
// Import-safe: no next/server, no module-load SDK construction.
import { z } from 'zod';
import { claudeChat } from '@/lib/ai/claude';
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_GEN_MODEL, CLAUDE_GRADING_MODEL } from '@/lib/ai/models';
import { LlmExhaustedError } from '@/lib/ai/errors';

export interface AssignmentGradeInput {
  assignmentTitle: string;
  tasks: Array<{ step: number; description: string }>;
  responses: Record<string, { text: string; image_url: string | null }>;
}

const AssignmentGradeResultSchema = z.object({
  overall_grade: z.number().min(0).max(100),
  overall_feedback: z.string(),
  task_grades: z.array(z.object({ step: z.number(), grade: z.number().min(0).max(100), feedback: z.string() })),
});
export type AssignmentGradeResult = z.infer<typeof AssignmentGradeResultSchema>;

const SYSTEM = [
  'You are an experienced, encouraging K-12 teacher grading a student assignment.',
  'Grade each task on its own merits against the task description and the rubric below, then give an overall grade.',
  'RUBRIC (0-100): no work 5-15; off-topic 0-15; partial/developing 20-59; complete/proficient 60-100.',
  'Feedback speaks TO the student about THEIR RESPONSE, is warm, names what to try next, and NEVER reveals the correct answer.',
  'Do NOT put any number, percentage, score word, or grade inside any feedback string — feedback is words only.',
  'Return ONLY valid JSON, no markdown fences, matching: {"overall_grade":int,"overall_feedback":str,"task_grades":[{"step":int,"grade":int,"feedback":str}]}.',
].join('\n');

function buildPrompt(input: AssignmentGradeInput): string {
  const lines = [`Assignment: ${input.assignmentTitle}`, ''];
  for (const t of input.tasks) {
    const a = input.responses[String(t.step)];
    lines.push(`Task ${t.step}: ${t.description}`);
    lines.push(`Student response: ${a?.text?.trim() || (a?.image_url ? '[submitted a drawing/image]' : '[no response]')}`);
    lines.push('');
  }
  lines.push('Grade every task (by step) and the overall assignment. Return the JSON object only.');
  return lines.join('\n');
}

function tryParse(raw: string | null): AssignmentGradeResult | null {
  if (!raw) return null;
  try { const r = AssignmentGradeResultSchema.safeParse(JSON.parse(raw)); return r.success ? r.data : null; }
  catch { return null; }
}

export async function gradeAssignment(input: AssignmentGradeInput): Promise<AssignmentGradeResult> {
  const userPrompt = buildPrompt(input);

  let claudeRaw: string | null = null;
  try { claudeRaw = await claudeChat(SYSTEM, userPrompt, { temperature: 0.3, maxTokens: 800, model: CLAUDE_GRADING_MODEL }); }
  catch { /* fall through to GPT */ }
  const claudeParsed = tryParse(claudeRaw);
  if (claudeParsed) return claudeParsed;

  let gptRaw: string | null = null;
  try {
    const completion = await resilientChatCompletion({
      model: OPENAI_GEN_MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt }],
      temperature: 0.3, max_tokens: 800, response_format: { type: 'json_object' },
    });
    gptRaw = completion?.choices?.[0]?.message?.content ?? null;
  } catch { /* terminal below */ }
  const gptParsed = tryParse(gptRaw);
  if (gptParsed) return gptParsed;

  throw new LlmExhaustedError('claude+openai');
}
