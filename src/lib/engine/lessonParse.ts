// src/lib/engine/lessonParse.ts
// Engine call #1 (import-safe). LIFT V1 app/api/teacher/lessons/parse/route.ts:94–106.
// No next/server, no cookies() — pure async fn, safe to import in any context.
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import { LESSON_PARSE_SYSTEM, lessonParsePrompt } from '@/lib/openai/prompts';
import { ParsedLessonSchema, type ParsedLesson } from '@/lib/engine/types';
import { LlmExhaustedError } from '@/lib/ai/errors';

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
  // Parse failure on a structured-output call is terminal (no silent default on a persisted artifact).
  const parsed = ParsedLessonSchema.parse(JSON.parse(raw));
  return parsed;
}
