// src/lib/skills/errorPatternMap.ts
// Maps a graded-OEQ grading_output to V1's session error-pattern vocabulary.
// Returns null when there is no error signal (omit from sessionErrorPatterns).
//
// V1 vocabulary: conceptual | procedural | careless | random
// Grader vocabulary: error_type (8 codes) + reasoning_pattern (6 codes)
// from misconception_types seed (0011_signals.sql).
//
// Source: ONLY graded-OEQ grading_output — NOT MCQ rows, NOT a separate table.

export function toSessionErrorPattern(
  g: { error_type?: string | null; reasoning_pattern?: string | null },
): 'conceptual' | 'procedural' | 'careless' | 'random' | null {
  const e = g.error_type;
  const r = g.reasoning_pattern;

  // conceptual: student has the wrong model — needs different instruction
  if (r === 'misconception' || e === 'reasoning_gap' || e === 'vocabulary_confusion') {
    return 'conceptual';
  }

  // procedural: student knows the concept but execution is incomplete/shallow
  if (r === 'surface_recall' || e === 'incomplete') {
    return 'procedural';
  }

  // careless: student likely knows but misread/made a slip
  if (e === 'factual_error' || e === 'misunderstood_question') {
    return 'careless';
  }

  // random: blank, off-topic — no signal about what they know
  if (e === 'off_topic' || e === 'blank' || r === 'blank_or_off_topic') {
    return 'random';
  }

  // none / full_reasoning / creative_extension / partial_reasoning → no error signal
  return null;
}
