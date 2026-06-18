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
});
