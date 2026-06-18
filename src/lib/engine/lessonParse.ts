// src/lib/engine/lessonParse.ts
// Engine call #1 (import-safe). LIFT V1 app/api/teacher/lessons/parse/route.ts:94–106.
// No next/server, no cookies() — pure async fn, safe to import in any context.
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import { LESSON_PARSE_SYSTEM, lessonParsePrompt } from '@/lib/openai/prompts';
import { ParsedLessonSchema, type ParsedLesson } from '@/lib/engine/types';
import { LlmExhaustedError } from '@/lib/ai/errors';
import { ZodError } from 'zod';

export async function parseLesson(lessonText: string): Promise<ParsedLesson> {
  if (!lessonText.trim()) throw new Error('parseLesson: empty lesson text');
  const completion = await resilientChatCompletion({
    model: OPENAI_GEN_MODEL,
    messages: [
      { role: 'system', content: LESSON_PARSE_SYSTEM },
      { role: 'user', content: lessonParsePrompt(lessonText) },
    ],
    temperature: 0.3,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });
  // Real resilientChatCompletion throws LlmExhaustedError on terminal failure.
  // Guard for null covers the test-mock path and any future null-returning adapters.
  if (!completion) throw new LlmExhaustedError('openai');
  const raw = completion.choices[0]?.message?.content || '{}';
  // ZodError on LLM-generated output is a transient model quality failure — re-throw
  // as LlmExhaustedError so the route catch maps it to 503 retryable (§3.5), not 500.
  try {
    const parsed = ParsedLessonSchema.parse(JSON.parse(raw));
    return parsed;
  } catch (err) {
    if (err instanceof ZodError) throw new LlmExhaustedError('openai', err);
    throw err;
  }
}
