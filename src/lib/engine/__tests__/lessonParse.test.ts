// src/lib/engine/__tests__/lessonParse.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';

const mockChat = vi.fn();
vi.mock('@/lib/ai/openai', () => ({ resilientChatCompletion: (...a: unknown[]) => mockChat(...a) }));

describe('parseLesson', () => {
  beforeEach(() => mockChat.mockReset());
  it('returns validated parsed lesson JSON', async () => {
    mockChat.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        title: 'Photosynthesis', key_concepts: ['light', 'chlorophyll'],
        objectives: ['Explain photosynthesis'], misconception_risks: ['plants eat soil'],
        grade_level: '7th grade', subject: 'Science', summary: 'How plants make food.',
      }) } }],
    });
    const { parseLesson } = await import('@/lib/engine/lessonParse');
    const out = await parseLesson('A lesson about photosynthesis.');
    expect(out.title).toBe('Photosynthesis');
    expect(out.key_concepts).toContain('chlorophyll');
  });

  it('throws LlmExhaustedError when the wrapper returns null (terminal failure)', async () => {
    mockChat.mockResolvedValue(null);
    const { parseLesson } = await import('@/lib/engine/lessonParse');
    await expect(parseLesson('x')).rejects.toBeInstanceOf(LlmExhaustedError);
  });

  // C1 throw-path test: real wrapper THROWS LlmExhaustedError — must propagate.
  it('propagates LlmExhaustedError thrown by the wrapper (real throw path)', async () => {
    mockChat.mockRejectedValueOnce(new LlmExhaustedError('openai'));
    const { parseLesson } = await import('@/lib/engine/lessonParse');
    let caught: unknown;
    try {
      await parseLesson('some lesson text');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LlmExhaustedError);
  });

  // ZodError → LlmExhaustedError: malformed LLM output must map to 503 retryable.
  it('re-throws ZodError as LlmExhaustedError (wrong-shaped LLM JSON → 503 retryable)', async () => {
    // Return valid JSON but with wrong shape — ParsedLessonSchema.parse() will throw ZodError.
    mockChat.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ unexpected_field: 'bad', score: 999 }) } }],
    });
    const { parseLesson } = await import('@/lib/engine/lessonParse');
    // ParsedLessonSchema may allow extra fields (it's optional-heavy) — use a truly invalid value
    // to ensure ZodError. If the schema accepts any shape, we force a ZodError by returning
    // non-object JSON (e.g. an array at top level which fails z.object()).
    mockChat.mockResolvedValue({
      choices: [{ message: { content: '[1,2,3]' } }],
    });
    await expect(parseLesson('some text')).rejects.toBeInstanceOf(LlmExhaustedError);
  });
});
