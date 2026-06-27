// src/lib/chapters/generateChapterTest.ts
//
// generateChapterQuestions — Claude-driven chapter test question engine.
//
// Called from `after()` in the POST /api/teacher/chapter-tests route.
// NEVER throws — all errors are caught and surfaced via generation_status='failed'.
//
// Architecture:
//   1. Update generation_status to 'generating'
//   2. Load chapter_test_sections for the test
//   3. For each student × each section:
//        a. Idempotency check — skip if (section_id, student_id) already has rows
//        b. Build Claude prompt (per-student, per-section)
//        c. Call resilientClaudeChat (NO temperature — opus-4.x returns 400)
//        d. Parse JSON → insert chapter_test_questions rows
//   4. On complete: mark 'ready'
//   5. On LlmExhaustedError: mark 'failed' and return early
//   6. On any other unhandled exception: mark 'failed' and return
//
// Points distribution: floor(total_points / question_count) per question;
// last question absorbs the remainder so the total stays exact.
//
// V1 reference: core/lib/teacher/chapterTestGenerator.ts

import type { SupabaseClient } from '@supabase/supabase-js';
import { resilientClaudeChat } from '@/lib/ai/claude';
import { LlmExhaustedError } from '@/lib/ai/errors';
import { CLAUDE_CHAPTER_MODEL } from '@/lib/ai/models';
import { getTemplate, type ChapterTestTemplate } from '@/lib/chapters/chapterTemplates';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface StudentContext {
  studentId: string;
  /** Snapshot of the student's comprehension band at generation time. Null = grade_level. */
  comprehension_band: string | null;
  /** Snapshot of the student's learning style at generation time. Null = not determined. */
  learning_style: string | null;
}

export interface GenerateChapterQuestionsArgs {
  admin: SupabaseClient;
  chapterTestId: string;
  students: StudentContext[];
  /** parsed_content of all lessons in the chapter, one entry per lesson */
  lessonTexts: string[];
  template: ChapterTestTemplate;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface SectionRow {
  id: string;
  section_order: number;
  section_kind: string;
  title: string;
  time_minutes: number;
  total_points: number;
}

interface GeneratedQuestion {
  question_order: number;
  question_type: string;
  question_text: string;
  payload: Record<string, unknown>;
  points: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Distribute totalPoints evenly across questionCount questions.
 * The last question absorbs any remainder so the section total stays exact.
 *
 * Examples:
 *   distributePoints(15, 2)  → [7, 8]
 *   distributePoints(10, 6)  → [1, 1, 1, 1, 1, 5]
 *   distributePoints(10, 1)  → [10]
 */
export function distributePoints(totalPoints: number, questionCount: number): number[] {
  if (questionCount <= 0) return [];
  if (questionCount === 1) return [totalPoints];
  const perQ = Math.floor(totalPoints / questionCount);
  const last = totalPoints - perQ * (questionCount - 1);
  return [...Array(questionCount - 1).fill(perQ), last];
}

/**
 * Build the system + user prompts for one section × one student.
 */
function buildPrompt(
  section: SectionRow,
  student: StudentContext,
  lessonTexts: string[],
  questionCount: number,
): { system: string; user: string } {
  const band = student.comprehension_band ?? 'grade_level';
  const style = student.learning_style ?? 'not specified';
  const lessonContent =
    lessonTexts.length > 0
      ? lessonTexts.join('\n\n---\n\n')
      : '(no lesson content provided)';

  const system =
    'You are generating chapter test questions for a student. ' +
    'Return valid JSON only, no markdown code fences, no extra text. ' +
    'The JSON must be an object with a "questions" array.';

  const user =
    `Generate exactly ${questionCount} question(s) for this test section:\n\n` +
    `Section: ${section.title}\n` +
    `Section kind: ${section.section_kind}\n` +
    `Time limit: ${section.time_minutes} minutes\n` +
    `Total section points: ${section.total_points}\n` +
    `Student comprehension band: ${band}\n` +
    `Student learning style: ${style}\n\n` +
    `Lesson content:\n${lessonContent}\n\n` +
    `Return JSON with this exact shape:\n` +
    `{\n` +
    `  "questions": [\n` +
    `    {\n` +
    `      "question_order": 1,\n` +
    `      "question_type": "<type>",\n` +
    `      "question_text": "<question>",\n` +
    `      "payload": {},\n` +
    `      "points": <integer>\n` +
    `    }\n` +
    `  ]\n` +
    `}\n\n` +
    `Valid question_type values: mcq, matching, short_answer, data_interpretation, mini_essay, multi_step_problem\n\n` +
    `Payload shapes:\n` +
    `- mcq: { "choices": [{"label":"A","text":"..."}], "correct_answer": "A", "rationale": "..." }\n` +
    `- matching: { "left": ["..."], "right": ["..."], "pairs": [{"left_idx":0,"right_idx":0}] }\n` +
    `- short_answer: { "rubric": "...", "expected_signals": ["..."] }\n` +
    `- data_interpretation: { "prompt": "...", "rubric": "..." }\n` +
    `- mini_essay: { "rubric": "...", "claim_evidence_explanation_required": true }\n` +
    `- multi_step_problem: { "setup": "...", "work_steps_required": true, "verification_required": true, "rubric": "..." }\n\n` +
    `Align difficulty for comprehension band "${band}".`;

  return { system, user };
}

// ── Main engine ───────────────────────────────────────────────────────────────

/**
 * Generate per-student chapter test questions for all sections.
 *
 * Called from after() in the chapter-tests creation route — NEVER throws.
 * Any unhandled exception is caught and surfaced as generation_status='failed'.
 */
export async function generateChapterQuestions(
  args: GenerateChapterQuestionsArgs,
): Promise<void> {
  const { admin, chapterTestId, students, lessonTexts, template } = args;
  const templateDef = getTemplate(template);

  try {
    // Step 1: Mark generating
    await admin
      .from('chapter_tests')
      .update({ generation_status: 'generating' })
      .eq('id', chapterTestId);

    // Step 2: Load sections ordered by section_order
    const { data: rawSections, error: sectionsError } = await admin
      .from('chapter_test_sections')
      .select('id, section_order, section_kind, title, time_minutes, total_points')
      .eq('chapter_test_id', chapterTestId)
      .order('section_order');

    if (sectionsError || !rawSections || (rawSections as SectionRow[]).length === 0) {
      console.error('[generateChapterQuestions] Failed to load sections:', sectionsError);
      await admin
        .from('chapter_tests')
        .update({ generation_status: 'failed' })
        .eq('id', chapterTestId);
      return;
    }

    const sections = rawSections as SectionRow[];

    // Step 3: Process students serially — avoid API rate limits at pilot scale
    for (const student of students) {
      for (const section of sections) {
        // C1 — Idempotency: skip (section_id, student_id) pairs that already have rows
        const { data: existing } = await admin
          .from('chapter_test_questions')
          .select('id')
          .eq('section_id', section.id)
          .eq('student_id', student.studentId);

        if (existing && (existing as unknown[]).length > 0) {
          continue; // Already generated — skip this pair
        }

        // Look up question_count from the locked template definition
        const templateSection = templateDef.sections.find((s) => s.kind === section.section_kind);
        const questionCount = templateSection?.question_count ?? 1;
        const pointsDistribution = distributePoints(section.total_points, questionCount);

        // Build prompt — NO temperature (CLAUDE_CHAPTER_MODEL is opus-4.x → 400 on temperature)
        const { system, user } = buildPrompt(section, student, lessonTexts, questionCount);

        let generatedQuestions: GeneratedQuestion[] | null = null;

        try {
          const result = await resilientClaudeChat({
            system,
            messages: [{ role: 'user', content: user }],
            model: CLAUDE_CHAPTER_MODEL,
            max_tokens: 2000,
            // temperature intentionally omitted
          });

          if (result?.content) {
            try {
              const parsed = JSON.parse(result.content) as { questions?: GeneratedQuestion[] };
              if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
                generatedQuestions = parsed.questions;
              } else {
                console.warn(
                  `[generateChapterQuestions] Empty or missing questions array — section ${section.id}, student ${student.studentId}`,
                );
              }
            } catch (parseErr) {
              // JSON parse failure: log and continue (fail-soft — skip this section)
              console.error(
                `[generateChapterQuestions] JSON parse error — section ${section.id}, student ${student.studentId}:`,
                parseErr,
              );
            }
          } else {
            console.warn(
              `[generateChapterQuestions] No content from Claude — section ${section.id}, student ${student.studentId}`,
            );
          }
        } catch (llmErr) {
          if (llmErr instanceof LlmExhaustedError) {
            // Fatal: LLM exhausted — mark failed and exit immediately. Do NOT proceed.
            console.error('[generateChapterQuestions] LLM exhausted — marking failed:', llmErr);
            await admin
              .from('chapter_tests')
              .update({ generation_status: 'failed' })
              .eq('id', chapterTestId);
            return;
          }
          // Unexpected non-LlmExhaustedError: log and continue to next section
          console.error(
            `[generateChapterQuestions] Unexpected error calling Claude — section ${section.id}:`,
            llmErr,
          );
        }

        if (!generatedQuestions) {
          // Claude returned unusable output — skip this (section, student) pair
          continue;
        }

        // Build insert rows — preserve question_order 1-based, use distributed points
        const rows = generatedQuestions.slice(0, questionCount).map((q, i) => ({
          section_id: section.id,
          student_id: student.studentId,
          question_order: i + 1,
          question_type: q.question_type,
          question_text: q.question_text,
          payload: q.payload ?? {},
          points: pointsDistribution[i] ?? Math.floor(section.total_points / questionCount),
          comprehension_band: student.comprehension_band,
          learning_style: student.learning_style,
        }));

        const { error: insertError } = await admin
          .from('chapter_test_questions')
          .insert(rows);

        if (insertError) {
          // Insert error: log and continue — don't fail the whole generation
          console.error(
            `[generateChapterQuestions] Insert error — section ${section.id}, student ${student.studentId}:`,
            insertError,
          );
        }
      }
    }

    // Step 4: All students processed — mark ready
    await admin
      .from('chapter_tests')
      .update({ generation_status: 'ready' })
      .eq('id', chapterTestId);
  } catch (err) {
    // Unexpected fatal error — mark failed, never re-throw (caller is after())
    console.error('[generateChapterQuestions] Unexpected fatal error:', err);
    try {
      await admin
        .from('chapter_tests')
        .update({ generation_status: 'failed' })
        .eq('id', chapterTestId);
    } catch (updateErr) {
      console.error('[generateChapterQuestions] Failed to mark generation_status=failed:', updateErr);
    }
  }
}
