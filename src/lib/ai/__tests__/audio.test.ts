// src/lib/ai/__tests__/audio.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmExhaustedError } from '@/lib/ai/errors';

const transcriptionsCreate = vi.fn();
const speechCreate = vi.fn();
vi.mock('openai', () => {
  class OpenAI { audio = { transcriptions: { create: transcriptionsCreate }, speech: { create: speechCreate } }; }
  return { default: OpenAI, toFile: async (b: unknown, name: string) => ({ name, b }) };
});

describe('resilientAudioTranscription', () => {
  beforeEach(() => { transcriptionsCreate.mockReset(); speechCreate.mockReset(); });

  it('returns the transcript string (response_format text → string)', async () => {
    transcriptionsCreate.mockResolvedValue('Hello there.');
    const { resilientAudioTranscription } = await import('@/lib/ai/openai');
    const out = await resilientAudioTranscription({ buffer: Buffer.from('x'), filename: 'audio.webm' });
    expect(out).toBe('Hello there.');
    expect(transcriptionsCreate).toHaveBeenCalledOnce();
  });

  it('tolerates an object {text} result', async () => {
    transcriptionsCreate.mockResolvedValue({ text: 'From an object.' });
    const { resilientAudioTranscription } = await import('@/lib/ai/openai');
    expect(await resilientAudioTranscription({ buffer: Buffer.from('x'), filename: 'a.webm' })).toBe('From an object.');
  });

  it('throws LlmExhaustedError on a non-retryable (400) failure', async () => {
    transcriptionsCreate.mockRejectedValue({ status: 400, message: 'bad' });
    const { resilientAudioTranscription } = await import('@/lib/ai/openai');
    await expect(resilientAudioTranscription({ buffer: Buffer.from('x'), filename: 'a.webm' })).rejects.toBeInstanceOf(LlmExhaustedError);
  });

  it('retries a retryable (503) error then succeeds', async () => {
    transcriptionsCreate.mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce('Recovered.');
    const { resilientAudioTranscription } = await import('@/lib/ai/openai');
    const out = await resilientAudioTranscription({ buffer: Buffer.from('x'), filename: 'a.webm' }, { initialDelayMs: 0, maxDelayMs: 0 });
    expect(out).toBe('Recovered.');
    expect(transcriptionsCreate).toHaveBeenCalledTimes(2);
  });

  it('retries maxRetries+1 times on a persistent 503 then throws', async () => {
    transcriptionsCreate.mockRejectedValue({ status: 503 });
    const { resilientAudioTranscription } = await import('@/lib/ai/openai');
    await expect(
      resilientAudioTranscription({ buffer: Buffer.from('x'), filename: 'a.webm' }, { maxRetries: 2, initialDelayMs: 0, maxDelayMs: 0 }),
    ).rejects.toBeInstanceOf(LlmExhaustedError);
    expect(transcriptionsCreate).toHaveBeenCalledTimes(3);
  });
});

describe('resilientTextToSpeech', () => {
  beforeEach(() => { speechCreate.mockReset(); });
  it('returns a Buffer of the audio bytes', async () => {
    speechCreate.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    const { resilientTextToSpeech } = await import('@/lib/ai/openai');
    const out = await resilientTextToSpeech('Read this aloud.');
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(3);
    expect(speechCreate).toHaveBeenCalledOnce();
  });
  it('throws LlmExhaustedError on terminal failure', async () => {
    speechCreate.mockRejectedValue({ status: 500, message: 'down' });
    const { resilientTextToSpeech } = await import('@/lib/ai/openai');
    await expect(resilientTextToSpeech('x', { maxRetries: 0 })).rejects.toBeInstanceOf(LlmExhaustedError);
  });

  it('retries a retryable (500) error then succeeds', async () => {
    speechCreate
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ arrayBuffer: async () => new Uint8Array([9]).buffer });
    const { resilientTextToSpeech } = await import('@/lib/ai/openai');
    const out = await resilientTextToSpeech('x', { initialDelayMs: 0, maxDelayMs: 0 });
    expect(out.length).toBe(1);
    expect(speechCreate).toHaveBeenCalledTimes(2);
  });
});
