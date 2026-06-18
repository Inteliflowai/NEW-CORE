// src/lib/workflow/generationPipeline.ts
// DEFAULT durable execution = direct awaited calls with per-step retry (inside each
// engine fn's wrapper) + idempotency (skip a step whose output is already cached).
// WDK is a week-1 SPIKE only (docs/spikes/wdk-spike.md); the awaited path is what ships
// (spec §3.6). The teacher interactive create path stays synchronous/streaming and does
// NOT route through here — this governs background/durable generation + regeneration.
import { parseLesson } from '@/lib/engine/lessonParse';
import { generateQuiz } from '@/lib/engine/quizGen';
import type { ParsedLesson, GeneratedQuiz } from '@/lib/engine/types';

export interface PipelineInput {
  lessonText: string;
  parsedLesson?: ParsedLesson;   // idempotency: if present, the parse step is already done
  quiz?: GeneratedQuiz;          // idempotency: if present, the quiz step is already done
}
export interface PipelineResult {
  parsedLesson: ParsedLesson;
  quiz: GeneratedQuiz;
}

export async function runGenerationPipeline(input: PipelineInput): Promise<PipelineResult> {
  // Step 1 — lesson parse (skip if already cached; retry lives inside parseLesson's wrapper).
  const parsedLesson = input.parsedLesson ?? (await parseLesson(input.lessonText));
  // Step 2 — quiz gen (skip if cached).
  const quiz = input.quiz ?? (await generateQuiz(JSON.stringify(parsedLesson), parsedLesson.subject ?? null));
  return { parsedLesson, quiz };
}
