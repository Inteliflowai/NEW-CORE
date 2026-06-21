import { hasBannedWord } from '@/lib/copy/leakGuard';
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
export function failsSyncGate(reply: string): boolean {
  return heuristicRevealsAnswer(reply) || hasBannedWord(reply);
}
const MOVE_PATTERNS: RegExp[] = [
  /\b(let'?s|try|start by|what if|think about|focus on|compare|separate|picture|imagine|notice|break it (?:down|into))\b/i,
  /\?\s*$/,
];
export function namesAThinkingMove(reply: string): boolean {
  return MOVE_PATTERNS.some((re) => re.test(reply.trim()));
}
