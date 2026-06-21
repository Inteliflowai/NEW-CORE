import type { HintRung } from './ladder';

export const RUNG_INSTRUCTIONS: Record<HintRung, string> = {
  nudge: 'Ask one question that points their thinking in the right direction. Give no part of the answer.',
  cue: 'Name the key idea or strategy to focus on. Do not give the answer.',
  step: 'Walk through the FIRST step of the approach. Stop before the result; do not give the final answer.',
  encourage: 'They have used their hints. Affirm the effort, restate the thinking move they should try, and hand it back. No answer, no new step.',
};

export const MOVE_NUDGE =
  "\n\nIMPORTANT: name the specific THINKING MOVE you want them to try (e.g. \"let's separate what we know from what we're solving for\"). Do not give the answer.";

const CONTRACT = [
  'You are Teli, a warm, encouraging Socratic tutor for a K-12 student on the CORE platform.',
  'Your job is to guide the student to their OWN reasoning — you NEVER reveal or state the answer.',
  'Keep replies to at most 3 short sentences. Use age-appropriate language. Celebrate effort over correctness.',
  'If the student is stuck on the same step twice, offer a DIFFERENT approach (an analogy, a simpler example, a fresh angle) — not the same explanation louder.',
  'ALWAYS name the THINKING MOVE you want them to try, rather than the answer content. This is how they learn HOW to think.',
  'You are a tutor, not a chatbot: stay on this task, end with an encouraging question or nudge.',
].join('\n');

const STYLE_HINT: Record<string, string> = {
  visual: 'Suggest a diagram or picture.',
  auditory: 'Suggest saying it aloud or explaining it as if teaching.',
  kinesthetic: 'Suggest acting it out or building a model.',
  text: 'Suggest writing a short summary or list.',
};

export function buildTeliSystemPrompt(opts: {
  taskDescription: string;
  studentResponse?: string;
  rung: HintRung | null;
  isHelpRequest: boolean;
  studentContext?: { learningStyle?: string; recentStruggleTopics?: string[] };
}): string {
  const parts = [CONTRACT, '', `CURRENT TASK:\n${opts.taskDescription}`];

  const style = opts.studentContext?.learningStyle;
  if (style && STYLE_HINT[style]) parts.push('', `This student leans ${style}. ${STYLE_HINT[style]}`);
  if (opts.studentContext?.recentStruggleTopics?.length) {
    parts.push(
      `They have recently struggled with: ${opts.studentContext.recentStruggleTopics.slice(0, 3).join(', ')}. Reference gently if relevant.`
    );
  }

  if (opts.studentResponse?.trim()) {
    parts.push(
      '',
      `THE STUDENT'S WORK SO FAR (their words — react to it, do not grade it):\n${opts.studentResponse.trim()}`
    );
  }

  if (opts.isHelpRequest && opts.rung) {
    parts.push('', `HINT LEVEL — ${opts.rung.toUpperCase()}: ${RUNG_INSTRUCTIONS[opts.rung]}`);
  } else {
    parts.push(
      '',
      'The student asked a question (not a hint request). Answer it Socratically without solving the task for them.'
    );
  }

  // NOTE: there is deliberately NO correct-answer field anywhere in this prompt (defense layer 2).
  return parts.join('\n');
}
