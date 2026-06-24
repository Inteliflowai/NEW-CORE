import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import { encryptToken, decryptToken } from '@/lib/google/crypto';

const origFetch = globalThis.fetch;
beforeEach(() => {
  process.env.GOOGLE_TOKEN_ENC_KEY = randomBytes(32).toString('base64');
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'csec';
});
afterEach(() => {
  globalThis.fetch = origFetch;
  vi.restoreAllMocks();
  delete process.env.GOOGLE_TOKEN_ENC_KEY;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
});

function adminWith(row: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    from() {
      return {
        select() { return { eq() { return { maybeSingle: async () => ({ data: row, error: null }) }; } }; },
        update(vals: Record<string, unknown>) { updates.push(vals); return { eq: async () => ({ error: null }) }; },
      };
    },
  };
}

describe('getValidAccessTokenForTeacher', () => {
  it('throws GoogleNotConnectedError when there is no connection', async () => {
    const { getValidAccessTokenForTeacher, GoogleNotConnectedError } = await import('@/lib/google/tokens');
    await expect(getValidAccessTokenForTeacher(adminWith(null) as never, 'u1'))
      .rejects.toBeInstanceOf(GoogleNotConnectedError);
  });
  it('returns the decrypted token when not expired (no refresh call)', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const admin = adminWith({ access_token_enc: encryptToken('LIVE'), refresh_token_enc: encryptToken('RT'), token_expiry: future });
    const { getValidAccessTokenForTeacher } = await import('@/lib/google/tokens');
    expect(await getValidAccessTokenForTeacher(admin as never, 'u1')).toBe('LIVE');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refreshes + persists when expired', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'FRESH', expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch;
    const past = new Date(Date.now() - 60_000).toISOString();
    const admin = adminWith({ access_token_enc: encryptToken('OLD'), refresh_token_enc: encryptToken('RT'), token_expiry: past });
    const { getValidAccessTokenForTeacher } = await import('@/lib/google/tokens');
    expect(await getValidAccessTokenForTeacher(admin as never, 'u1')).toBe('FRESH');
    expect(admin.updates).toHaveLength(1);
    // Prove the persisted token is ENCRYPTED ciphertext of 'FRESH' (D4), not plaintext/stale.
    expect(admin.updates[0].access_token_enc).not.toBe('FRESH');
    expect(decryptToken(admin.updates[0].access_token_enc as string)).toBe('FRESH');
    expect('refresh_token_enc' in admin.updates[0]).toBe(false);  // refresh token not re-persisted
    expect(new Date(admin.updates[0].token_expiry as string).getTime()).toBeGreaterThan(Date.now());
  });
  it('rejects with a non-GoogleNotConnectedError when the refresh returns non-200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('bad', { status: 400 })) as unknown as typeof fetch;
    const past = new Date(Date.now() - 60_000).toISOString();
    const admin = adminWith({ access_token_enc: encryptToken('OLD'), refresh_token_enc: encryptToken('RT'), token_expiry: past });
    const { getValidAccessTokenForTeacher, GoogleNotConnectedError } = await import('@/lib/google/tokens');
    let caught: unknown;
    try { await getValidAccessTokenForTeacher(admin as never, 'u1'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(GoogleNotConnectedError);
    expect((caught as Error).message).toMatch(/refresh/);
  });
});
