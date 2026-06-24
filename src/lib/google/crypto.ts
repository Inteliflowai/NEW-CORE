// src/lib/google/crypto.ts
// AES-256-GCM token-at-rest encryption (node:crypto, zero deps). Format: iv.tag.ciphertext (base64url).
// The key (GOOGLE_TOKEN_ENC_KEY) is read at call-time so tests/runtime can set it per-process.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function encKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENC_KEY;
  if (!raw) throw new Error('GOOGLE_TOKEN_ENC_KEY is not configured');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_TOKEN_ENC_KEY must decode to 32 bytes');
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

export function decryptToken(blob: string): string {
  const parts = blob.split('.');
  if (parts.length !== 3) throw new Error('malformed encrypted token');
  const [ivB, tagB, ctB] = parts;
  const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
}
