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

// Teli's reply is student-facing, BUT Teli's prompt contains NO diagnostic machinery (no band,
// score, or risk — only the task + the student's words), so the dashboard leak-guard BANNED_WORDS
// (leakGuard.ts) is the WRONG gate here: it whole-word-bans ordinary K-12 tutoring vocabulary
// (model/signal/threshold/index/algorithm/flag) and silently degraded on-topic Socratic hints to
// the SAFE_FALLBACK — Teli's own STYLE_HINT even says "build a model", tripping its own gate.
// The never-reveal wall is heuristicRevealsAnswer + the LLM classifier; this reduced set keeps
// ONLY the pure assessment/diagnostic words a tutor should never utter to a student.
// DRAFT → Barb (four-audience copy owner). See review finding (2026-06-22).
export const TELI_OUTPUT_BANNED: readonly string[] = ['score', 'percentile', 'divergence'];
const TELI_BANNED_RE = new RegExp(`\\b(?:${TELI_OUTPUT_BANNED.join('|')})\\b`, 'i');

export function failsSyncGate(reply: string): boolean {
  return heuristicRevealsAnswer(reply) || TELI_BANNED_RE.test(reply);
}
const MOVE_PATTERNS: RegExp[] = [
  /\b(let'?s|try|start by|what if|think about|focus on|compare|separate|picture|imagine|notice|break it (?:down|into))\b/i,
  /\?\s*$/,
];
export function namesAThinkingMove(reply: string): boolean {
  return MOVE_PATTERNS.some((re) => re.test(reply.trim()));
}
