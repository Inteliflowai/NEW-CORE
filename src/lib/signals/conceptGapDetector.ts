// src/lib/signals/conceptGapDetector.ts
// Pure. No DB calls, no AI calls, no next/server imports.
// Constants and gap-detection math lifted verbatim from
// V1 lib/signals/conceptGapDetector.ts (THRESHOLD_PCT, MIN_STUDENTS, pct formula).
//
// V2 structural adaptation: pure function over caller-provided data
// (V1 was DB-coupled async; V2 caller fetches data and passes it in).

export const THRESHOLD_PCT = 40; // minimum % incorrect to flag as gap
export const MIN_STUDENTS  = 5;  // need at least 5 attempts per question to detect a pattern

export interface ConceptGapInput {
  questions: {
    questionIndex: number;
    questionText: string;
  }[];
  responses: {
    studentId: string;
    questionIndex: number;
    isCorrect: boolean;
  }[];
}

export interface ConceptGapResult {
  question_index: number;
  question_text: string;
  pct_incorrect: number;
}

/**
 * Detect class-wide concept gaps from pre-fetched quiz response data.
 *
 * A gap is flagged when:
 *   - At least MIN_STUDENTS (5) students answered the question, AND
 *   - At least THRESHOLD_PCT (40)% got it wrong.
 *
 * The threshold math is lifted verbatim from V1:
 *   pct = Math.round((incorrect / total) * 100)
 *   if (pct >= THRESHOLD_PCT) -> flag
 *
 * The caller is responsible for generating reteach suggestions (LLM or
 * fallback) and persisting to concept_gaps — kept out of this pure fn.
 */
export function detectConceptGaps(data: ConceptGapInput): ConceptGapResult[] {
  const questionMap = new Map(
    data.questions.map((q) => [q.questionIndex, q.questionText]),
  );

  // Group responses by question index
  const positionStats = new Map<number, { total: number; incorrect: number }>();

  for (const r of data.responses) {
    const stats = positionStats.get(r.questionIndex) ?? { total: 0, incorrect: 0 };
    stats.total++;
    if (!r.isCorrect) stats.incorrect++;
    positionStats.set(r.questionIndex, stats);
  }

  const gaps: ConceptGapResult[] = [];

  for (const [questionIndex, stats] of positionStats) {
    if (stats.total < MIN_STUDENTS) continue;
    // Verbatim from V1: pct = Math.round((incorrect / total) * 100)
    const pct = Math.round((stats.incorrect / stats.total) * 100);
    if (pct >= THRESHOLD_PCT) {
      gaps.push({
        question_index: questionIndex,
        question_text: questionMap.get(questionIndex) ?? `Question ${questionIndex}`,
        pct_incorrect: pct,
      });
    }
  }

  return gaps;
}
