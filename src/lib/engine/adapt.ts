// src/lib/engine/adapt.ts
// Engine call #3 (import-safe). LIFT V1 app/api/attempts/[attemptId]/adapt/route.ts:54–162.
// Within-attempt reshape of Q4–Q5 off the Q1–Q3 MCQ %. Bands single-sourced from
// computeMasteryBand (0–50 scaffolded / 51–79 grade_level / 80+ advanced). NEVER blocks
// the attempt: on terminal LLM failure it returns the original Q4/Q5 (adapt:151–161).
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import { computeMasteryBand } from '@/lib/utils/scoring';
import { AdaptedQuestionsSchema, type AdaptedQuestions } from '@/lib/engine/types';

export interface AdaptInput {
  correctCount: number;        // of 3 MCQ
  lessonContext: string;       // JSON.stringify(parsed_content).slice(0, 2000)
  originalQ4: string;
  originalQ5: string;
  extraSystemContext?: string; // teacher notes / student model — passed by the route
}

const LEVEL_INSTRUCTIONS: Record<'advanced' | 'grade_level' | 'scaffolded', string> = {
  advanced: 'The student scored 80%+ on MCQs. Generate EXTENSION open-response questions that push deeper thinking, require synthesis, and challenge with real-world application. Use sophisticated vocabulary.',
  grade_level: 'The student scored 50-79% on MCQs. Generate STANDARD open-response questions that reinforce core concepts with moderate challenge. Support critical thinking.',
  scaffolded: 'The student scored below 50% on MCQs. Generate SCAFFOLDED open-response questions with built-in support. Break down complex ideas, use simpler language, provide sentence starters where helpful.',
};

/**
 * Reshape Q4–Q5 based on Q1–Q3 MCQ performance.
 *
 * NEVER throws — on terminal LLM failure (LlmExhaustedError), null completion,
 * or schema-invalid response, returns the original Q4/Q5 as the fallback.
 * This is the documented exception to §3.5: adapt must never block the attempt.
 */
export async function adaptQuestions(input: AdaptInput): Promise<AdaptedQuestions> {
  const mcqPct = Math.round((input.correctCount / 3) * 100);
  const band = computeMasteryBand(mcqPct);
  const level: 'advanced' | 'grade_level' | 'scaffolded' = band === 'reteach' ? 'scaffolded' : band;

  // Fallback object — returned on any failure; never throws.
  const fallback: AdaptedQuestions = {
    level: level,
    mcq_pct: mcqPct,
    questions: [
      { position: 4, question_text: input.originalQ4 || '', rubric: '', scaffold_hint: '', difficulty_label: 'Standard' },
      { position: 5, question_text: input.originalQ5 || '', rubric: '', scaffold_hint: '', difficulty_label: 'Standard' },
    ],
  };

  try {
    let system = 'You are a personalized assessment engine for K-12 students. Generate personalized open-response questions based on student performance. Always return valid JSON.';
    if (input.extraSystemContext) system += `\n\n${input.extraSystemContext}`;

    const completion = await resilientChatCompletion({
      model: OPENAI_GEN_MODEL,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Student MCQ performance: ${input.correctCount}/3 correct (${mcqPct}%) — adaptation level: ${level.toUpperCase()}

${LEVEL_INSTRUCTIONS[level]}

Lesson topic: ${input.lessonContext}

Original Q4: ${input.originalQ4 || 'N/A'}
Original Q5: ${input.originalQ5 || 'N/A'}

Generate 2 personalized open-response questions for this student. Return JSON:
{
  "level": "${level}",
  "mcq_pct": ${mcqPct},
  "questions": [
    { "position": 4, "question_text": "...", "rubric": "...", "scaffold_hint": "...", "difficulty_label": "..." },
    { "position": 5, "question_text": "...", "rubric": "...", "scaffold_hint": "...", "difficulty_label": "..." }
  ]
}

scaffold_hint: a Socratic opening hint shown only if student requests help (never the answer).
difficulty_label: one of "Scaffolded", "Standard", "Extension", "Challenge".
rubric: brief 1-2 sentence grading guide.`.trim(),
        },
      ],
      temperature: 0.7,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
    });

    // Adapt is the documented exception to §3.5: degrade to original Q4/Q5, never block.
    if (!completion) {
      console.warn('[adapt] null completion — falling back to original questions');
      return fallback;
    }

    const raw = completion.choices[0]?.message?.content || '{}';
    return AdaptedQuestionsSchema.parse(JSON.parse(raw));
  } catch (err) {
    // Catches: LlmExhaustedError (provider exhaustion), ZodError (malformed reshape),
    // JSON.parse errors, and any other unexpected failure. Never re-throw — adapt must
    // never block the attempt (V1 adapt:151–161).
    console.warn('[adapt] failed, returning original questions:', err instanceof Error ? err.message : String(err));
    return fallback;
  }
}
