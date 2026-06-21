// src/lib/ai/__tests__/claude.test.ts
// Asserts model-routing in resilientClaudeChat and claudeChat:
//   1. resilientClaudeChat sends params.model when provided.
//   2. resilientClaudeChat defaults to CLAUDE_GRADING_MODEL when model is omitted.
//   3. claudeChat passes options.model through to resilientClaudeChat.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CLAUDE_GRADING_MODEL } from '@/lib/ai/models';

describe('resilientClaudeChat — model routing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('sends params.model to the SDK when provided', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create };
      },
    }));

    const { resilientClaudeChat } = await import('@/lib/ai/claude');
    await resilientClaudeChat(
      { messages: [{ role: 'user', content: 'hi' }], model: 'claude-opus-4-8' },
      { maxRetries: 0 },
    );

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].model).toBe('claude-opus-4-8');
  });

  it('OMITS temperature for opus-4-8 (deprecated on that model — sends 400)', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create };
      },
    }));

    const { resilientClaudeChat } = await import('@/lib/ai/claude');
    await resilientClaudeChat(
      { messages: [{ role: 'user', content: 'hi' }], model: 'claude-opus-4-8', temperature: 0.7 },
      { maxRetries: 0 },
    );

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].temperature).toBeUndefined();
  });

  it('SENDS temperature for sonnet-4-6 (still supported)', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create };
      },
    }));

    const { resilientClaudeChat } = await import('@/lib/ai/claude');
    await resilientClaudeChat(
      { messages: [{ role: 'user', content: 'hi' }], model: 'claude-sonnet-4-6', temperature: 0.7 },
      { maxRetries: 0 },
    );

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].temperature).toBe(0.7);
  });

  it('defaults to CLAUDE_GRADING_MODEL when model is omitted', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create };
      },
    }));

    const { resilientClaudeChat } = await import('@/lib/ai/claude');
    await resilientClaudeChat(
      { messages: [{ role: 'user', content: 'hi' }] },
      { maxRetries: 0 },
    );

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].model).toBe(CLAUDE_GRADING_MODEL);
  });
});

describe('claudeChat — model routing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes options.model through to the SDK create call', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'response' }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create };
      },
    }));

    const { claudeChat } = await import('@/lib/ai/claude');
    await claudeChat('system', 'user', { model: 'claude-opus-4-8' });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].model).toBe('claude-opus-4-8');
  });

  it('uses CLAUDE_GRADING_MODEL when no model option is provided', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'response' }],
    });

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { create };
      },
    }));

    const { claudeChat } = await import('@/lib/ai/claude');
    await claudeChat('system', 'user');

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].model).toBe(CLAUDE_GRADING_MODEL);
  });
});
