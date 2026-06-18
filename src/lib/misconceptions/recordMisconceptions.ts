// src/lib/misconceptions/recordMisconceptions.ts
// Writes misconception_observations rows for OEQ responses at submit time.
//
// Rules (Barb-ratified, spec §4):
//   - Only question_type_scored === 'open' (OEQ) responses are recorded.
//   - error_type === 'none' responses are excluded (not a real misconception).
//   - MCQ/numeric responses (question_type_scored !== 'open') are excluded even
//     if the grader assigned a factual_error code — these are synthetic.
//   - Fail-isolated: an insert error never throws; written count tracks successes.
//
// Import-safe: no next/server, no cookies(), no module-load SDK construction.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PerResponseInput {
  responseId: string;       // REAL quiz_responses.id uuid (C2 — NOT a composite key)
  studentId: string;
  skillId: string | null;   // null is allowed — misconception is still observed
  error_type: string;
  reasoning_pattern: string;
  questionTypeScored: string;
}

export interface RecordMisconceptionsInput {
  schoolId: string;
  perResponse: PerResponseInput[];
}

export async function recordMisconceptions(
  admin: SupabaseClient,
  input: RecordMisconceptionsInput,
): Promise<{ written: number }> {
  // Only OEQ responses with a real error (not 'none' and not empty)
  const eligible = input.perResponse.filter(
    (r) => r.questionTypeScored === 'open' && r.error_type !== 'none' && r.error_type !== '',
  );

  let written = 0;

  for (const r of eligible) {
    try {
      const { error } = await admin.from('misconception_observations').insert({
        student_id: r.studentId,
        skill_id: r.skillId ?? null,
        quiz_response_id: r.responseId,
        error_type: r.error_type,
        reasoning_pattern: r.reasoning_pattern,
        observed_at: new Date().toISOString(),
        school_id: input.schoolId,
      });
      if (!error) {
        written++;
      } else {
        console.error('[recordMisconceptions] insert error:', error);
      }
    } catch (err) {
      console.error('[recordMisconceptions] unexpected error:', err);
    }
  }

  return { written };
}
