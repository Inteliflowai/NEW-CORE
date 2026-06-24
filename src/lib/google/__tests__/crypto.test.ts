import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';
import { encryptToken, decryptToken } from '@/lib/google/crypto';

beforeEach(() => { process.env.GOOGLE_TOKEN_ENC_KEY = randomBytes(32).toString('base64'); });

describe('google/crypto', () => {
  it('round-trips a token through encrypt/decrypt', () => {
    const secret = 'ya29.a0AfH-EXAMPLE-refresh-token';
    const blob = encryptToken(secret);
    expect(blob.split('.')).toHaveLength(3);     // iv.tag.ciphertext
    expect(blob).not.toContain(secret);          // ciphertext, not plaintext
    expect(decryptToken(blob)).toBe(secret);
  });
  it('produces a different ciphertext each call (random IV)', () => {
    expect(encryptToken('x')).not.toBe(encryptToken('x'));
  });
  it('throws when the auth tag is tampered', () => {
    const blob = encryptToken('hello');
    const [iv, , ct] = blob.split('.');
    const forgedTag = randomBytes(16).toString('base64url');
    expect(() => decryptToken(`${iv}.${forgedTag}.${ct}`)).toThrow();
  });
  it('throws on a malformed blob', () => {
    expect(() => decryptToken('not-a-valid-blob')).toThrow();
  });
  it('throws when GOOGLE_TOKEN_ENC_KEY is missing', () => {
    delete process.env.GOOGLE_TOKEN_ENC_KEY;
    expect(() => encryptToken('x')).toThrow(/GOOGLE_TOKEN_ENC_KEY/);
  });
});
