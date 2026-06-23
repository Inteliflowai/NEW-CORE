// src/lib/engine/lessonGenerate.ts
// Engine (import-safe): AI lesson generation + multi-day unit segmentation.
// Mirrors lessonParse.ts exactly — OPENAI_GEN_MODEL, json_object, throw LlmExhaustedError.
// No next/server, no Supabase.
import { resilientChatCompletion } from '@/lib/ai/openai';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import {
  LESSON_GENERATE_SYSTEM, lessonGeneratePrompt,
  UNIT_SEGMENT_SYSTEM, unitSegmentPrompt,
} from '@/lib/openai/prompts';
import {
  GeneratedLessonSchema, type GeneratedLesson,
  UnitSegmentsSchema, type UnitSegments,
} from '@/lib/engine/types';
import { LlmExhaustedError } from '@/lib/ai/errors';
import { ZodError } from 'zod';

export const MAX_GENERATE_DAYS = 10;

export function resolveNumDays(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 2) return 1;
  return Math.min(n, MAX_GENERATE_DAYS);
}

export interface GenerateLessonInput {
  description: string;
  subject?: string | null;
  grade_level?: string | null;
  focus?: string | null;
  standardsGuidance?: string | null;
}

export async function generateLesson(input: GenerateLessonInput): Promise<GeneratedLesson> {
  if (!input.description.trim()) throw new Error('generateLesson: empty description');
  const completion = await resilientChatCompletion({
    model: OPENAI_GEN_MODEL,
    messages: [
      { role: 'system', content: LESSON_GENERATE_SYSTEM },
      { role: 'user', content: lessonGeneratePrompt(input) },
    ],
    temperature: 0.6,
    max_tokens: 2500,
    response_format: { type: 'json_object' },
  });
  if (!completion) throw new LlmExhaustedError('openai');
  const raw = completion.choices[0]?.message?.content || '{}';
  try {
    return GeneratedLessonSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof ZodError) throw new LlmExhaustedError('openai', err);
    throw err;
  }
}

export async function segmentUnit(input: {
  description: string;
  numDays: number;
  subject?: string | null;
  grade_level?: string | null;
}): Promise<UnitSegments> {
  const numDays = Math.min(Math.max(2, Math.floor(input.numDays)), MAX_GENERATE_DAYS);
  const completion = await resilientChatCompletion({
    model: OPENAI_GEN_MODEL,
    messages: [
      { role: 'system', content: UNIT_SEGMENT_SYSTEM },
      { role: 'user', content: unitSegmentPrompt({ ...input, numDays }) },
    ],
    temperature: 0.5,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  });
  if (!completion) throw new LlmExhaustedError('openai');
  const raw = completion.choices[0]?.message?.content || '{}';
  try {
    return UnitSegmentsSchema.parse(JSON.parse(raw));
  } catch (err) {
    if (err instanceof ZodError) throw new LlmExhaustedError('openai', err);
    throw err;
  }
}
