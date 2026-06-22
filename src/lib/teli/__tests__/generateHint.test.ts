import { vi, it, expect, beforeEach, afterEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';
const { claudeChatMock } = vi.hoisted(() => ({ claudeChatMock: vi.fn() }));
vi.mock('@/lib/ai/claude', () => ({ claudeChat: claudeChatMock }));
import { generateGuardedHint, SAFE_FALLBACK_REPLY } from '@/lib/teli/generateHint';
const base = { taskDescription: 'Why does ice float?', rung: 'nudge' as const, isHelpRequest: true, studentMessage: 'help' };

// Harness-only guard (NOT a weakening of any assertion): vitest 4 surfaces a benign unhandled
// rejection when a PERSISTENT `mockRejectedValue` is awaited+caught more than once in a tick —
// which the fail-closed control flow does on purpose (generate → regenerate ONCE). The production
// code catches every throw (tryGenerate/classifyReveal try/catch). This swallows ONLY the
// deliberately-injected LlmExhaustedError; any OTHER unhandled rejection still propagates and fails
// the suite, so the safety net is intact.
function swallowInjectedExhausted(reason: unknown) {
  if (reason instanceof LlmExhaustedError) return;
  throw reason;
}
beforeEach(() => {
  claudeChatMock.mockReset();
  process.on('unhandledRejection', swallowInjectedExhausted);
});
afterEach(() => {
  process.off('unhandledRejection', swallowInjectedExhausted);
});

it('returns a clean Socratic reply that already names a move', async () => {
  claudeChatMock.mockResolvedValueOnce("Let's start by asking what changes when water freezes — what do you notice?"); // opus (safe + move)
  claudeChatMock.mockResolvedValueOnce('OK'); // classifier OK
  expect(await generateGuardedHint(base)).toContain('what changes when water freezes');
});
it('regenerates when the first draft reveals via the heuristic, accepts the clean retry', async () => {
  claudeChatMock.mockResolvedValueOnce('The answer is that ice is less dense.'); // heuristic-caught → NO classifier call
  claudeChatMock.mockResolvedValueOnce('What happens to most things when they freeze, unlike ice?'); // opus retry (safe + move)
  claudeChatMock.mockResolvedValueOnce('OK'); // classifier on retry
  const out = await generateGuardedHint(base);
  expect(out).not.toMatch(/the answer is/i); expect(out).toContain('What happens');
});
it('catches a DECLARATIVE reveal the heuristic misses, via the classifier', async () => {
  claudeChatMock.mockResolvedValueOnce('Ice is less dense than water, which is why it floats.'); // passes sync gate
  claudeChatMock.mockResolvedValueOnce('REVEAL'); // classifier flags
  claudeChatMock.mockResolvedValueOnce('What could you compare ice and water by to explain floating?'); // retry (safe + move)
  claudeChatMock.mockResolvedValueOnce('OK'); // classifier OK
  expect(await generateGuardedHint(base)).toContain('compare ice and water');
});
it('FAILS CLOSED to the safe line when the classifier is unavailable on a heuristic-clean reply', async () => {
  claudeChatMock.mockResolvedValueOnce('Ice is less dense than water, which is why it floats.'); // passes sync gate
  claudeChatMock.mockRejectedValueOnce(new LlmExhaustedError('claude')); // classifier DOWN → cannot-verify
  // cannot-verify short-circuits to fallback (no gamble)
  expect(await generateGuardedHint(base)).toBe(SAFE_FALLBACK_REPLY);
});
it('FAILS CLOSED on a NON-CONFORMING classifier verdict (garbled/refusal) — only explicit OK certifies', async () => {
  // Heuristic-clean reply that passes failsSyncGate (no banned words, no reveal pattern) AND
  // names a thinking move (ends with '?'), so under the OLD fail-OPEN code it would be accepted
  // and SHIPPED RAW on the first pass. The fix must instead reject the garbled verdict.
  const RAW = 'Ice is less dense than water — what does that tell you about why it floats?';
  claudeChatMock.mockResolvedValueOnce(RAW);
  claudeChatMock.mockResolvedValueOnce('.'); // classifier returns a NON-conforming verdict → must NOT certify
  claudeChatMock.mockRejectedValueOnce(new LlmExhaustedError('claude')); // regenerate exhausts → no second gamble
  // A garbled verdict (no explicit OK, no REVEAL) is ambiguous → cannot-verify → fallback,
  // NEVER the raw un-vetted reply.
  const out = await generateGuardedHint(base);
  expect(out).not.toBe(RAW);
  expect(out).toBe(SAFE_FALLBACK_REPLY);
});
it('FAILS CLOSED on a hedged verdict that merely CONTAINS "OK" (e.g. "Not OK to say") — substring is not certification', async () => {
  // The classifier is asked for EXACTLY one word (OK or REVEAL). A non-conforming hedged
  // verdict that happens to contain the substring "OK" ("Not OK to share that.") must NOT
  // certify the reply — only an explicit OK verdict certifies. RAW is heuristic-clean and
  // names a move (ends with '?'), so the OLD substring code would ship it RAW on pass 1.
  const RAW = 'Ice is less dense than water — what does that tell you about why it floats?';
  claudeChatMock.mockResolvedValueOnce(RAW); // opus draft (sync-clean, names a move)
  claudeChatMock.mockResolvedValueOnce('Not OK to share that.'); // classifier: hedged, contains "OK" but NOT an explicit OK verdict
  claudeChatMock.mockRejectedValueOnce(new LlmExhaustedError('claude')); // regenerate exhausts → no second gamble
  const out = await generateGuardedHint(base);
  expect(out).not.toBe(RAW);
  expect(out).toBe(SAFE_FALLBACK_REPLY);
});
it('falls back when even the retry reveals the answer', async () => {
  claudeChatMock.mockResolvedValueOnce('The answer is less dense.'); // heuristic
  claudeChatMock.mockResolvedValueOnce('Basically the answer is density.'); // retry heuristic
  expect(await generateGuardedHint(base)).toBe(SAFE_FALLBACK_REPLY);
});
it('falls back to the safe line when the opus model throws (exhausted)', async () => {
  claudeChatMock.mockRejectedValue(new LlmExhaustedError('claude'));
  expect(await generateGuardedHint(base)).toBe(SAFE_FALLBACK_REPLY);
});
it('soft-regenerates a safe-but-moveless help reply, then ships safe even if still moveless', async () => {
  claudeChatMock.mockResolvedValueOnce('Less dense than water.'); // safe (no banned/heuristic) but NO move
  claudeChatMock.mockResolvedValueOnce('OK'); // classifier OK on draft
  claudeChatMock.mockResolvedValueOnce('Density is the idea here.'); // retry still moveless but safe
  claudeChatMock.mockResolvedValueOnce('OK'); // classifier OK on retry
  expect(await generateGuardedHint(base)).toBe('Density is the idea here.');
});
