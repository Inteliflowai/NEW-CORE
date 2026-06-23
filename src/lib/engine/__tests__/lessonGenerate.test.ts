// src/lib/engine/__tests__/lessonGenerate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';

const mockChat = vi.fn();
vi.mock('@/lib/ai/openai', () => ({ resilientChatCompletion: (...a: unknown[]) => mockChat(...a) }));

function completion(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

describe('lessonGenerate', () => {
  beforeEach(() => mockChat.mockReset());

  it('resolveNumDays: <2 / non-int → 1; caps at 10', async () => {
    const { resolveNumDays, MAX_GENERATE_DAYS } = await import('@/lib/engine/lessonGenerate');
    expect(resolveNumDays(1)).toBe(1);
    expect(resolveNumDays(0)).toBe(1);
    expect(resolveNumDays(2.5)).toBe(1);
    expect(resolveNumDays('x')).toBe(1);
    expect(resolveNumDays(3)).toBe(3);
    expect(resolveNumDays(99)).toBe(MAX_GENERATE_DAYS);
  });

  it('generateLesson returns a validated lesson with proposed_standards default', async () => {
    mockChat.mockResolvedValue(completion({
      title: 'Fractions', summary: 'A passage about fractions…',
      objectives: ['Add fractions'], key_concepts: ['numerator', 'denominator'],
      vocabulary: [{ term: 'fraction', definition: 'part of a whole' }],
      misconception_risks: ['bigger denominator = bigger number'],
      grade_level: '4', subject: 'Math',
      proposed_standards: [{ code: 'CCSS.MATH.4.NF.A.1', description: 'Equivalent fractions' }],
    }));
    const { generateLesson } = await import('@/lib/engine/lessonGenerate');
    const out = await generateLesson({ description: 'Teach adding fractions' });
    expect(out.title).toBe('Fractions');
    expect(out.proposed_standards[0].code).toMatch(/4\.NF/);
  });

  it('generateLesson defaults proposed_standards to [] when omitted', async () => {
    mockChat.mockResolvedValue(completion({ title: 'X', summary: 's' }));
    const { generateLesson } = await import('@/lib/engine/lessonGenerate');
    const out = await generateLesson({ description: 'x' });
    expect(out.proposed_standards).toEqual([]);
  });

  it('generateLesson throws LlmExhaustedError on null completion', async () => {
    mockChat.mockResolvedValue(null);
    const { generateLesson } = await import('@/lib/engine/lessonGenerate');
    await expect(generateLesson({ description: 'x' })).rejects.toBeInstanceOf(LlmExhaustedError);
  });

  it('generateLesson re-throws malformed JSON shape as LlmExhaustedError', async () => {
    mockChat.mockResolvedValue({ choices: [{ message: { content: '[1,2,3]' } }] });
    const { generateLesson } = await import('@/lib/engine/lessonGenerate');
    await expect(generateLesson({ description: 'x' })).rejects.toBeInstanceOf(LlmExhaustedError);
  });

  it('generateLesson rejects an empty description before calling the LLM', async () => {
    const { generateLesson } = await import('@/lib/engine/lessonGenerate');
    await expect(generateLesson({ description: '   ' })).rejects.toThrow();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('segmentUnit returns unit_title + days', async () => {
    mockChat.mockResolvedValue(completion({
      unit_title: 'Ecosystems', days: [
        { day: 1, title: 'Producers', focus: 'Plants make energy.' },
        { day: 2, title: 'Consumers', focus: 'Animals eat.' },
      ],
    }));
    const { segmentUnit } = await import('@/lib/engine/lessonGenerate');
    const out = await segmentUnit({ description: 'Ecosystems unit', numDays: 2 });
    expect(out.unit_title).toBe('Ecosystems');
    expect(out.days).toHaveLength(2);
    expect(out.days[1].focus).toMatch(/eat/);
  });

  it('segmentUnit throws LlmExhaustedError on malformed output', async () => {
    mockChat.mockResolvedValue(completion({ unit_title: 'x' })); // missing days[]
    const { segmentUnit } = await import('@/lib/engine/lessonGenerate');
    await expect(segmentUnit({ description: 'x', numDays: 2 })).rejects.toBeInstanceOf(LlmExhaustedError);
  });
});
