// src/lib/ai/__tests__/wrappers.test.ts
// TDD: failing tests first (red), then green after implementation.
// Tests: LlmExhaustedError shape, retry-then-succeed, primary-fails→fallback-succeeds,
// both-exhausted→throws LlmExhaustedError.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';

// ── LlmExhaustedError ─────────────────────────────────────────────────────────

describe('LlmExhaustedError', () => {
  it('is an Error with a provider tag', () => {
    const e = new LlmExhaustedError('claude', new Error('429'));
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('LlmExhaustedError');
    expect(e.provider).toBe('claude');
  });

  it('carries the cause', () => {
    const cause = new Error('rate limited');
    const e = new LlmExhaustedError('openai', cause);
    expect(e.cause).toBe(cause);
  });

  it('has a readable message', () => {
    const e = new LlmExhaustedError('claude');
    expect(e.message).toContain('claude');
  });
});

// ── wrapper modules import cleanly ────────────────────────────────────────────

describe('wrapper modules import cleanly', () => {
  it('claude + openai wrappers export their fns', async () => {
    const claude = await import('@/lib/ai/claude');
    const openai = await import('@/lib/ai/openai');
    expect(typeof claude.claudeChat).toBe('function');
    expect(typeof claude.resilientClaudeChat).toBe('function');
    expect(typeof openai.resilientChatCompletion).toBe('function');
    expect(typeof openai.resilientImageGeneration).toBe('function');
  });
});

// ── resilientClaudeChat behaviour ─────────────────────────────────────────────
// Note: each test calls vi.resetModules() + vi.doMock() to isolate SDK mocks.
// LlmExhaustedError is re-imported fresh (same module reset) so instanceof works.

describe('resilientClaudeChat', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('retry-then-succeed: returns content when first attempt fails and retry succeeds', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'hello from claude' }],
      });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create };
      },
    }));

    const { resilientClaudeChat } = await import('@/lib/ai/claude');
    const result = await resilientClaudeChat(
      { messages: [{ role: 'user', content: 'hi' }] },
      { maxRetries: 2, initialDelayMs: 0 },
    );
    expect(result).toEqual({ content: 'hello from claude' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('primary-fails→fallback-succeeds: returns content on the last allowed retry', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce({ status: 503, message: 'service unavailable' })
      .mockRejectedValueOnce({ status: 503, message: 'service unavailable' })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'recovered' }],
      });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create };
      },
    }));

    const { resilientClaudeChat } = await import('@/lib/ai/claude');
    const result = await resilientClaudeChat(
      { messages: [{ role: 'user', content: 'hi' }] },
      { maxRetries: 2, initialDelayMs: 0 },
    );
    expect(result).toEqual({ content: 'recovered' });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('both-exhausted→throws LlmExhaustedError when all retries fail', async () => {
    const create = vi.fn().mockRejectedValue({ status: 429, message: 'rate limited' });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create };
      },
    }));

    const { resilientClaudeChat } = await import('@/lib/ai/claude');
    // Use message-string match to avoid cross-instance instanceof issues
    await expect(
      resilientClaudeChat(
        { messages: [{ role: 'user', content: 'hi' }] },
        { maxRetries: 1, initialDelayMs: 0 },
      ),
    ).rejects.toThrow('LLM exhausted after retries (provider=claude)');
  });

  it('throws error with provider=claude and name=LlmExhaustedError', async () => {
    const create = vi.fn().mockRejectedValue({ status: 500, message: 'server error' });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create };
      },
    }));

    const { resilientClaudeChat } = await import('@/lib/ai/claude');
    const err = await resilientClaudeChat(
      { messages: [{ role: 'user', content: 'hi' }] },
      { maxRetries: 0, initialDelayMs: 0 },
    ).catch(e => e);
    expect(err.name).toBe('LlmExhaustedError');
    expect(err.provider).toBe('claude');
    expect(err).toBeInstanceOf(Error);
  });
});

// ── resilientChatCompletion behaviour ─────────────────────────────────────────

describe('resilientChatCompletion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('retry-then-succeed: returns completion when first attempt fails and retry succeeds', async () => {
    const completion = { id: 'c1', choices: [{ message: { content: 'ok' } }] };
    const create = vi.fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockResolvedValueOnce(completion);

    vi.doMock('openai', () => ({
      default: class {
        chat = { completions: { create } };
        images = { generate: vi.fn() };
      },
    }));

    const { resilientChatCompletion } = await import('@/lib/ai/openai');
    const result = await resilientChatCompletion(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
      { maxRetries: 2, initialDelayMs: 0 },
    );
    expect(result).toEqual(completion);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('both-exhausted→throws LlmExhaustedError when all retries fail', async () => {
    const create = vi.fn().mockRejectedValue({ status: 429, message: 'rate limited' });

    vi.doMock('openai', () => ({
      default: class {
        chat = { completions: { create } };
        images = { generate: vi.fn() };
      },
    }));

    const { resilientChatCompletion } = await import('@/lib/ai/openai');
    await expect(
      resilientChatCompletion(
        { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
        { maxRetries: 1, initialDelayMs: 0 },
      ),
    ).rejects.toThrow('LLM exhausted after retries (provider=openai)');
  });

  it('does NOT retry on non-retryable 400 status (throws immediately)', async () => {
    const create = vi.fn().mockRejectedValue({ status: 400, message: 'bad request' });

    vi.doMock('openai', () => ({
      default: class {
        chat = { completions: { create } };
        images = { generate: vi.fn() };
      },
    }));

    const { resilientChatCompletion } = await import('@/lib/ai/openai');
    // 400 is non-retryable — should throw LlmExhaustedError immediately (1 attempt)
    await expect(
      resilientChatCompletion(
        { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
        { maxRetries: 3, initialDelayMs: 0 },
      ),
    ).rejects.toThrow('LLM exhausted after retries (provider=openai)');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
