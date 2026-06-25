import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signLaunchState, verifyLaunchState, safeStudentDest, LAUNCH_STATE_PREFIX } from '@/lib/google/launchState';

const SECRET = 'test-launch-secret-0123456789abcdef';
beforeEach(() => { process.env.GOOGLE_LAUNCH_STATE_SECRET = SECRET; });
afterEach(() => { delete process.env.GOOGLE_LAUNCH_STATE_SECRET; });

describe('signLaunchState / verifyLaunchState', () => {
  it('round-trips a valid state', () => {
    const s = signLaunchState({ gc: 'assignment', id: 'L1', nonce: 'n1', mode: 'silent' });
    expect(s.startsWith(LAUNCH_STATE_PREFIX)).toBe(true);
    const p = verifyLaunchState(s);
    expect(p).toMatchObject({ gc: 'assignment', id: 'L1', nonce: 'n1', mode: 'silent' });
    expect(typeof p!.exp).toBe('number');
  });
  it('rejects a tampered signature', () => {
    const s = signLaunchState({ gc: 'quiz', id: 'Q1', nonce: 'n1', mode: 'silent' });
    const bad = s.slice(0, -2) + (s.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyLaunchState(bad)).toBeNull();
  });
  it('rejects a non-launch prefix', () => {
    expect(verifyLaunchState('csrf-abc')).toBeNull();
    expect(verifyLaunchState(null)).toBeNull();
  });
  it('rejects an expired state', () => {
    const expired = signLaunchState({ gc: 'quiz', id: 'Q1', nonce: 'n1', mode: 'silent' }, 1000, 1); // exp=1001
    expect(verifyLaunchState(expired)).toBeNull(); // default now = real wall-clock >> 1001
  });
  it('rejects invalid fields (gc / empty id / empty nonce / mode)', () => {
    // forge a structurally valid signature over a bad payload using the same secret
    const { createHmac } = require('crypto') as typeof import('crypto');
    const mk = (obj: object) => {
      const body = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
      const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
      return `${LAUNCH_STATE_PREFIX}${body}.${sig}`;
    };
    const now = Math.floor(Date.now() / 1000) + 100;
    expect(verifyLaunchState(mk({ gc: 'nope', id: 'x', nonce: 'n', mode: 'silent', exp: now }))).toBeNull();
    expect(verifyLaunchState(mk({ gc: 'quiz', id: '', nonce: 'n', mode: 'silent', exp: now }))).toBeNull();
    expect(verifyLaunchState(mk({ gc: 'quiz', id: 'x', nonce: '', mode: 'silent', exp: now }))).toBeNull();
    expect(verifyLaunchState(mk({ gc: 'quiz', id: 'x', nonce: 'n', mode: 'bogus', exp: now }))).toBeNull();
  });
  it('returns null when the secret is missing (fail-closed, no throw)', () => {
    const s = signLaunchState({ gc: 'quiz', id: 'Q1', nonce: 'n1', mode: 'silent' });
    delete process.env.GOOGLE_LAUNCH_STATE_SECRET;
    expect(verifyLaunchState(s)).toBeNull();
  });
});

describe('safeStudentDest', () => {
  it('passes internal /student paths', () => {
    expect(safeStudentDest('/student/assignments/abc')).toBe('/student/assignments/abc');
    expect(safeStudentDest('/student/quiz')).toBe('/student/quiz');
    expect(safeStudentDest('/student')).toBe('/student');
  });
  it('falls back for non-/student or unsafe paths', () => {
    expect(safeStudentDest('/teacher/x')).toBe('/student/dashboard');
    expect(safeStudentDest('//evil.com')).toBe('/student/dashboard');
    expect(safeStudentDest('https://evil.com')).toBe('/student/dashboard');
    expect(safeStudentDest('/student\\..\\x')).toBe('/student/dashboard');
    expect(safeStudentDest('/student/../admin')).toBe('/student/dashboard'); // forward-slash traversal (m4)
    expect(safeStudentDest('/student/x\nSet-Cookie: y')).toBe('/student/dashboard');
    expect(safeStudentDest('/studentfoo')).toBe('/student/dashboard');
  });
});
