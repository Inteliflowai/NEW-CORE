import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const origFetch = globalThis.fetch;
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'csec';
  process.env.GOOGLE_REDIRECT_URI = 'https://x/api/auth/google/callback';
});
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });
describe('exchangeCodeForTokens', () => {
  it('POSTs the code and returns the token response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: 'a b' }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { exchangeCodeForTokens } = await import('@/lib/google/tokens');
    const out = await exchangeCodeForTokens('auth-code');
    expect(out.access_token).toBe('at'); expect(out.refresh_token).toBe('rt'); expect(out.expires_in).toBe(3599);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('grant_type=authorization_code');
  });
  it('throws on a non-200 exchange', async () => {
    globalThis.fetch = vi.fn(async () => new Response('bad', { status: 400 })) as unknown as typeof fetch;
    const { exchangeCodeForTokens } = await import('@/lib/google/tokens');
    await expect(exchangeCodeForTokens('x')).rejects.toThrow();
  });
});
