import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const transcribe = vi.fn();
vi.mock('@/lib/ai/openai', () => ({ resilientAudioTranscription: (...a: unknown[]) => transcribe(...a) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: { getUser } }) }));

function req(file: Blob | null) {
  const f = new FormData();
  if (file) f.append('file', file, 'a.webm');
  return new NextRequest('http://x/api/attempts/transcribe', { method: 'POST', body: f });
}
const audio = (bytes: number, type = 'audio/webm') => new Blob([new Uint8Array(bytes)], { type });

beforeEach(() => {
  getUser.mockReset(); transcribe.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  transcribe.mockResolvedValue('  Hello there.  ');
});

describe('POST /api/attempts/transcribe', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    expect((await POST(req(audio(2048)))).status).toBe(401);
  });
  it('400 with no file', async () => {
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    expect((await POST(req(null))).status).toBe(400);
  });
  it('415 on a non-audio file', async () => {
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    expect((await POST(req(audio(2048, 'application/pdf')))).status).toBe(415);
  });
  it('400 too_short on a tiny blob (no transcribe call)', async () => {
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    const res = await POST(req(audio(100)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('too_short');
    expect(transcribe).not.toHaveBeenCalled();
  });
  it('returns the trimmed transcript on success', async () => {
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    const res = await POST(req(audio(2048)));
    expect(res.status).toBe(200);
    expect((await res.json()).transcript).toBe('Hello there.');
  });
  it('503 when transcription exhausts the LLM', async () => {
    const { LlmExhaustedError } = await import('@/lib/ai/errors');
    transcribe.mockRejectedValue(new LlmExhaustedError('openai'));
    const { POST } = await import('@/app/api/attempts/transcribe/route');
    expect((await POST(req(audio(2048)))).status).toBe(503);
  });
});
