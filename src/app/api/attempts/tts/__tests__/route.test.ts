import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const tts = vi.fn();
vi.mock('@/lib/ai/openai', () => ({ resilientTextToSpeech: (...a: unknown[]) => tts(...a) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: { getUser } }) }));

const req = (b: unknown) => new NextRequest('http://x/api/attempts/tts', { method: 'POST', body: JSON.stringify(b) });

beforeEach(() => {
  getUser.mockReset(); tts.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  tts.mockResolvedValue(Buffer.from([1, 2, 3]));
});

describe('POST /api/attempts/tts', () => {
  it('401 / 400 gates', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/attempts/tts/route');
    expect((await POST(req({ text: 'hi' }))).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    expect((await POST(req({ text: '   ' }))).status).toBe(400);
  });
  it('returns audio/mpeg bytes on success', async () => {
    const { POST } = await import('@/app/api/attempts/tts/route');
    const res = await POST(req({ text: 'Read this aloud.' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await res.arrayBuffer()).byteLength).toBe(3);
  });
  it('caps text to 4096 chars', async () => {
    const { POST } = await import('@/app/api/attempts/tts/route');
    await POST(req({ text: 'a'.repeat(5000) }));
    expect((tts.mock.calls[0][0] as string).length).toBe(4096);
  });
  it('503 when TTS exhausts the LLM', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    tts.mockRejectedValue(new LlmExhaustedError('openai'));
    const { POST } = await import('@/app/api/attempts/tts/route');
    expect((await POST(req({ text: 'hi' }))).status).toBe(503);
  });
});
