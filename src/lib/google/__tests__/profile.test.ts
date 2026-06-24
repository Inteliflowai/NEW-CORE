import { describe, it, expect, vi, afterEach } from 'vitest';
const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });
describe('getGoogleProfile', () => {
  it('GETs userinfo with the bearer token and returns the profile', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'g1', email: 'a@b.edu', name: 'A B', verified_email: true }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { getGoogleProfile } = await import('@/lib/google/profile');
    const p = await getGoogleProfile('access-tok');
    expect(p).toEqual({ id: 'g1', email: 'a@b.edu', name: 'A B', verified_email: true });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe('https://www.googleapis.com/oauth2/v2/userinfo');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer access-tok' });
  });
  it('throws on a non-200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    const { getGoogleProfile } = await import('@/lib/google/profile');
    await expect(getGoogleProfile('x')).rejects.toThrow();
  });
});
