import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
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
