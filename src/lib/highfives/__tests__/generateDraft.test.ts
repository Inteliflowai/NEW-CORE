import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ai from '@/lib/ai/claude';
import { generateHighFiveDraft, fallbackDraft } from '@/lib/highfives/generateDraft';
import { validateHighFive } from '@/lib/highfives/guardrail';

beforeEach(() => vi.restoreAllMocks());

describe('generateHighFiveDraft', () => {
  it('returns a clean AI draft when the model output passes the guardrail', async () => {
    vi.spyOn(ai, 'claudeChat').mockResolvedValue('Ann, you stuck with the tricky fraction problems all week.');
    const r = await generateHighFiveDraft({ studentName: 'Ann', contextHint: 'kept trying' });
    expect(r.source).toBe('ai');
    expect(validateHighFive(r.draft_text)).toEqual([]);
  });
  it('retries once when the first output violates, then accepts the clean retry', async () => {
    const spy = vi.spyOn(ai, 'claudeChat')
      .mockResolvedValueOnce('Great job!! amazing!')
      .mockResolvedValueOnce('Ann, you broke the problem into steps and worked through each one.');
    const r = await generateHighFiveDraft({ studentName: 'Ann' });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('ai_retry');
  });
  it('falls back deterministically when the model returns null', async () => {
    vi.spyOn(ai, 'claudeChat').mockResolvedValue(null);
    const r = await generateHighFiveDraft({ studentName: 'Ann' });
    expect(r.source).toBe('fallback');
    expect(r.draft_text).toContain('Ann');
    expect(validateHighFive(r.draft_text)).toEqual([]);
  });
  it('falls back when both passes violate', async () => {
    vi.spyOn(ai, 'claudeChat').mockResolvedValue('Awesome! perfect!');
    const r = await generateHighFiveDraft({ studentName: 'Ann' });
    expect(r.source).toBe('fallback');
  });
});

describe('fallbackDraft', () => {
  it('is itself guardrail-clean', () => { expect(validateHighFive(fallbackDraft('Ann'))).toEqual([]); });
});
