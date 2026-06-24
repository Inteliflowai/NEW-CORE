import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';
import { decryptToken } from '@/lib/google/crypto';

beforeEach(() => { process.env.GOOGLE_TOKEN_ENC_KEY = randomBytes(32).toString('base64'); });

function fakeAdmin() {
  const calls: { table: string; row: Record<string, unknown>; onConflict?: string }[] = [];
  return {
    calls,
    from(table: string) {
      return { upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
        calls.push({ table, row, onConflict: opts?.onConflict });
        return Promise.resolve({ error: null });
      } };
    },
  };
}

describe('storeConnection', () => {
  it('upserts an encrypted connection keyed on user_id', async () => {
    const admin = fakeAdmin();
    const { storeConnection } = await import('@/lib/google/tokens');
    await storeConnection(admin as never, {
      userId: 'u1', schoolId: 's1', googleId: 'g1', email: 'a@b.edu',
      tokens: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'openid x y' },
    });
    expect(admin.calls).toHaveLength(1);
    const { table, row, onConflict } = admin.calls[0];
    expect(table).toBe('google_connections');
    expect(onConflict).toBe('user_id');
    expect(row.user_id).toBe('u1');
    expect(row.access_token_enc).not.toBe('AT');               // encrypted
    expect(decryptToken(row.access_token_enc as string)).toBe('AT');
    expect(decryptToken(row.refresh_token_enc as string)).toBe('RT');
    expect(row.granted_scopes).toEqual(['openid', 'x', 'y']);
    expect(typeof row.token_expiry).toBe('string');            // ISO timestamp
  });
  it('omits refresh_token_enc when Google returns no refresh token', async () => {
    const admin = fakeAdmin();
    const { storeConnection } = await import('@/lib/google/tokens');
    await storeConnection(admin as never, {
      userId: 'u1', schoolId: null, googleId: 'g1', email: 'a@b.edu',
      tokens: { access_token: 'AT', expires_in: 3600 },
    });
    expect('refresh_token_enc' in admin.calls[0].row).toBe(false);
    expect(admin.calls[0].onConflict).toBe('user_id');   // still an upsert keyed on user_id → preserve path
  });
});
