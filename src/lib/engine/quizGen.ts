// src/lib/engine/quizGen.ts
// Engine call #2 (import-safe). LIFT V1 lib/teacher/generateQuizForLesson.ts:195-217.
// No next/server, no cookies() — pure async fn, safe to import in any context.
// C1: no degrade — LlmExhaustedError propagates to the caller; malformed payload
//     (fails GeneratedQuizSchema) is a terminal generation failure (throws, no persist).
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import { QUIZ_GENERATE_SYSTEM, quizGeneratePrompt, mathQuizGeneratePrompt } from '@/lib/openai/prompts';
import { isStemSubject } from '@/lib/teacher/isStemSubject';
import { GeneratedQuizSchema, type GeneratedQuiz } from '@/lib/engine/types';
import { LlmExhaustedError } from '@/lib/ai/errors';

/**
 * Generate a validated 5-question quiz from the parsed lesson.
 *
 * @param parsedLessonJson  JSON.stringify(lesson.parsed_content) — the parsed lesson object.
 * @param subject           lessons.subject (may fall back to parsed_content.subject upstream).
 *
 * Throws:
 *   - LlmExhaustedError — when resilientChatCompletion exhausts retries (C1: propagate, no degrade).
 *   - ZodError / Error   — when the LLM returns a malformed payload (not a valid 3+2 quiz).
 *     The route catch maps this to respondEngineError → 503/500, never persisting a partial quiz.
 */
export async function generateQuiz(
  parsedLessonJson: string,
  subject: string | null,
): Promise<GeneratedQuiz> {
  const isMath = isStemSubject(subject);
  const userPrompt = isMath
    ? mathQuizGeneratePrompt(parsedLessonJson)
    : quizGeneratePrompt(parsedLessonJson);

  // resilientChatCompletion throws LlmExhaustedError on terminal failure — no null path.
  const completion = await resilientChatCompletion({
    model: OPENAI_GEN_MODEL,
    messages: [
      { role: 'system', content: QUIZ_GENERATE_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.5,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
  });

  // Guard for null: covers test-mock path and any future null-returning adapters.
  if (!completion) throw new LlmExhaustedError('openai');

  const raw = completion.choices[0]?.message?.content || '{}';

  // GeneratedQuizSchema enforces the 3+2 tuple structure (positions 1-3 mcq|numeric,
  // positions 4-5 open). A partial or malformed payload throws here — caller must NOT
  // persist and should return 503 retryable via respondEngineError (§3.5, C1).
  return GeneratedQuizSchema.parse(JSON.parse(raw));
}
