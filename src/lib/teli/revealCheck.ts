// High-precision answer-handing patterns. The classifier (generateHint) is the real gate;
// these only catch the clearest giveaways so they short-circuit before the LLM check.
const REVEAL_PATTERNS: RegExp[] = [
  /\bthe (?:correct |final )?answer (?:is|would be|=)\b/i,
  /\bthe (?:final )?(?:result|solution) is\b/i,
  /\b(?:just|simply) (?:multiply|add|subtract|divide|write|put|say)\b[^?]*\bto get\b/i,
  /\byou should (?:write|put|say|answer)\b[^?]*\bthat\b/i,
];
export function heuristicRevealsAnswer(reply: string): boolean {
  return REVEAL_PATTERNS.some((re) => re.test(reply));
}

// The synchronous gate catches ONLY high-precision answer-handing (heuristicRevealsAnswer).
// It deliberately does NOT word-ban subject/assessment vocabulary: Teli's prompt holds no
// diagnostic machinery (no band/score/risk — only the task + the student's words), and a blunt
// word list cannot tell "the score was 24 to 21" (legitimate STEM vocabulary) from misuse — it
// over-blocked real Socratic hints (math/chemistry/physics/algebra/geometry/trig) into the
// SAFE_FALLBACK. Context is judged by the LLM reveal classifier in generateHint, which reads the
// whole reply; the never-reveal wall is heuristicRevealsAnswer + that classifier (fail-closed).
// Decision (Marvin, 2026-06-22): let these words through when relevant; the smart check judges,
// not a fixed list. DRAFT → Barb (four-audience copy owner).
export function failsSyncGate(reply: string): boolean {
  return heuristicRevealsAnswer(reply);
}
const MOVE_PATTERNS: RegExp[] = [
  /\b(let'?s|try|start by|what if|think about|focus on|compare|separate|picture|imagine|notice|break it (?:down|into))\b/i,
  /\?\s*$/,
];
export function namesAThinkingMove(reply: string): boolean {
  return MOVE_PATTERNS.some((re) => re.test(reply.trim()));
}
