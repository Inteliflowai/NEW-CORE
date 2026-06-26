import { describe, it, expect } from 'vitest';
import { usesLegacyTokenParam, tokenLimitParams, MODELS, MODEL_VERSION, CLAUDE_TUTOR_MODEL, CLAUDE_TUTOR_CHECK_MODEL, CLAUDE_CHAPTER_MODEL } from '@/lib/ai/models';

describe('usesLegacyTokenParam', () => {
  it('is true for gpt-4 / gpt-3 / fine-tuned legacy', () => {
    expect(usesLegacyTokenParam('gpt-4o')).toBe(true);
    expect(usesLegacyTokenParam('gpt-4o-mini')).toBe(true);
    expect(usesLegacyTokenParam('gpt-3.5-turbo')).toBe(true);
    expect(usesLegacyTokenParam('ft:gpt-4o-2024')).toBe(true);
  });
  it('is false for gpt-5 family / o-series / claude', () => {
    expect(usesLegacyTokenParam('gpt-5.4-mini')).toBe(false);
    expect(usesLegacyTokenParam('o3-mini')).toBe(false);
    expect(usesLegacyTokenParam('claude-opus-4-8')).toBe(false);
  });
});

describe('tokenLimitParams', () => {
  it('emits max_tokens for legacy models', () => {
    expect(tokenLimitParams('gpt-4o', 600)).toEqual({ max_tokens: 600 });
  });
  it('emits max_completion_tokens for newer models', () => {
    expect(tokenLimitParams('gpt-5.4-mini', 600)).toEqual({ max_completion_tokens: 600 });
  });
});

describe('registry exports', () => {
  it('exposes a MODELS object and a MODEL_VERSION string', () => {
    expect(typeof MODELS).toBe('object');
    expect(typeof MODEL_VERSION).toBe('string');
  });
});

describe('tutor model constants', () => {
  it('defaults Teli to claude-opus-4-8', () => { expect(CLAUDE_TUTOR_MODEL).toBe('claude-opus-4-8'); });
  it('uses a cheap model for the reveal classifier', () => { expect(CLAUDE_TUTOR_CHECK_MODEL).toBe('claude-haiku-4-5'); });
});

describe('chapter model constant', () => {
  it('CLAUDE_CHAPTER_MODEL defaults to claude-opus-4-8', () => {
    expect(CLAUDE_CHAPTER_MODEL).toBe('claude-opus-4-8');
  });
});
